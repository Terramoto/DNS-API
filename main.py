import asyncio
import ipaddress
import re
from contextlib import asynccontextmanager
from typing import Any, Dict, Iterable, Optional, Union

from fastapi import FastAPI, HTTPException, Query

from dns_lookup import DEFAULT_DKIM_SELECTORS, get_dns_records, get_domain_ips, get_ptr_record
from geoip_updater import start_background_updater, update_geoip_databases
from ip_info import get_ip_info, initialize_geoip_readers


@asynccontextmanager
async def lifespan(_: FastAPI):
    await asyncio.to_thread(update_geoip_databases)
    initialize_geoip_readers()
    start_background_updater(interval_hours=24, on_update=initialize_geoip_readers)
    yield


app = FastAPI(
    title="DNS Lookup API",
    description="API for retrieving DNS, mail-security, and IP geolocation information",
    version="1.1.0",
    lifespan=lifespan,
)


IPAddress = Union[ipaddress.IPv4Address, ipaddress.IPv6Address]


def _normalize_target(value: str) -> tuple[str, Optional[IPAddress]]:
    value = value.strip().rstrip(".")
    try:
        address = ipaddress.ip_address(value)
        return str(address), address
    except ValueError:
        pass

    try:
        ascii_domain = value.encode("idna").decode("ascii").lower()
    except UnicodeError as exc:
        raise HTTPException(status_code=422, detail="Invalid internationalized domain") from exc

    if len(ascii_domain) > 253 or not ascii_domain or "." not in ascii_domain:
        raise HTTPException(status_code=422, detail="Invalid domain")
    labels = ascii_domain.split(".")
    if any(
        len(label) > 63
        or not re.fullmatch(r"[a-z0-9](?:[a-z0-9-]*[a-z0-9])?", label)
        for label in labels
    ):
        raise HTTPException(status_code=422, detail="Invalid domain")
    return ascii_domain, None


def _parse_selectors(value: Optional[str]) -> Iterable[str]:
    if not value:
        return DEFAULT_DKIM_SELECTORS
    selectors = [selector.strip().lower() for selector in value.split(",") if selector.strip()]
    if len(selectors) > 10 or any(
        not re.fullmatch(r"[a-z0-9](?:[a-z0-9_-]{0,61}[a-z0-9])?", selector)
        for selector in selectors
    ):
        raise HTTPException(status_code=422, detail="Invalid DKIM selectors")
    return selectors


def _empty_ip_info(ip: str, ptr: Optional[str], provider: str, location: str) -> Dict[str, Any]:
    return {
        "ip": ip,
        "ptr": ptr,
        "provider": provider,
        "location": location,
        "coordinates": {"latitude": None, "longitude": None},
    }


async def _enrich_ip(ip: str, include_ptr: bool = False) -> Dict[str, Any]:
    try:
        ipaddress.ip_address(ip)
    except ValueError:
        return _empty_ip_info(ip, None, "Invalid IP", "N/A")

    ptr_record = await get_ptr_record(ip) if include_ptr else None
    info = get_ip_info(ip)
    if "error" in info:
        return _empty_ip_info(ip, ptr_record, "Unknown", "Unknown")

    coordinates = info.get("coordinates", "Unknown,Unknown")
    latitude, longitude = coordinates.split(",", 1) if "," in coordinates else (None, None)
    return {
        "ip": ip,
        "ptr": ptr_record,
        "provider": info.get("org", "Unknown"),
        "location": f"{info.get('city', 'Unknown')}, {info.get('region', 'Unknown')}, {info.get('country', 'Unknown')}",
        "coordinates": {
            "latitude": None if latitude == "Unknown" else latitude,
            "longitude": None if longitude == "Unknown" else longitude,
        },
    }


def _ip_only_records(address: IPAddress) -> Dict[str, Any]:
    return {
        "NS": [], "MX": [], "A": [str(address)] if address.version == 4 else [],
        "AAAA": [str(address)] if address.version == 6 else [], "TXT": [],
        "CNAME_WWW": [], "CAA": [], "SOA": None, "DMARC": [], "MTA_STS": [],
        "TLS_RPT": [], "DKIM": {},
        "DNSSEC": {"status": "not_applicable", "dnskey_present": False, "ds_present": False,
                   "note": "DNSSEC is not applicable to a direct IP lookup."},
        "lookup_errors": {}, "diagnostics": [],
    }


@app.get("/")
async def root() -> Dict[str, str]:
    return {"message": "DNS Lookup API is running. Use /dns-lookup/{domain_or_ip}."}


@app.get("/dns-lookup/{target}")
async def dns_lookup(
    target: str,
    dkim_selectors: Optional[str] = Query(
        default=None,
        description="Comma-separated DKIM selectors (maximum 10)",
    ),
) -> Dict[str, Any]:
    """Retrieve DNS/mail diagnostics for a domain or GeoIP/PTR data for an IP."""
    normalized, address = _normalize_target(target)

    try:
        records = (
            _ip_only_records(address)
            if address is not None
            else await get_dns_records(normalized, _parse_selectors(dkim_selectors))
        )

        a_info, aaaa_info = await asyncio.gather(
            asyncio.gather(*(_enrich_ip(ip, include_ptr=True) for ip in records["A"])),
            asyncio.gather(*(_enrich_ip(ip, include_ptr=True) for ip in records["AAAA"])),
        )
        records["A_IP_Info"] = list(a_info)
        records["AAAA_IP_Info"] = list(aaaa_info)

        for mx_record in records["MX"]:
            mx_domain = mx_record["mail_server"].rstrip(".")
            mx_ips = [] if not mx_domain else await get_domain_ips(mx_domain)
            mx_record["ips"] = mx_ips
            mx_record["ip_info"] = list(
                await asyncio.gather(*(_enrich_ip(ip) for ip in mx_ips))
            )
            if mx_domain and not mx_ips:
                records["diagnostics"].append({
                    "severity": "error",
                    "code": "unresolved_mx",
                    "message": f"MX target {mx_domain} has no A or AAAA address.",
                })

        cname_records = records["CNAME_WWW"]
        cname_ips = await asyncio.gather(
            *(get_domain_ips(cname.rstrip(".")) for cname in cname_records)
        )
        records["CNAME_WWW"] = [
            {"cname": cname, "ips": ips}
            for cname, ips in zip(cname_records, cname_ips)
        ]

        return {"domain": normalized, "records": records}
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail="Error retrieving DNS records") from exc


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000)
