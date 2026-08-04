import asyncio
from typing import Any, Dict, Iterable, List, Optional, Tuple

import dns.asyncresolver
import dns.exception
import dns.reversename
import dns.resolver


DEFAULT_DKIM_SELECTORS = ("default", "selector1", "selector2", "google")


def _resolver() -> dns.asyncresolver.Resolver:
    resolver = dns.asyncresolver.Resolver()
    resolver.timeout = 2.0
    resolver.lifetime = 4.0
    return resolver


async def _resolve(
    resolver: dns.asyncresolver.Resolver, name: str, record_type: str
) -> Tuple[List[Any], Optional[str]]:
    try:
        answer = await resolver.resolve(name, record_type)
        return list(answer), None
    except dns.resolver.NXDOMAIN:
        return [], "NXDOMAIN"
    except dns.resolver.NoAnswer:
        return [], "NO_ANSWER"
    except dns.resolver.NoNameservers:
        return [], "NO_NAMESERVERS"
    except dns.exception.Timeout:
        return [], "TIMEOUT"
    except Exception as exc:
        return [], f"ERROR: {type(exc).__name__}"


def _txt_value(record: Any) -> str:
    strings = getattr(record, "strings", None)
    if strings is not None:
        return b"".join(strings).decode("utf-8", errors="replace")
    return str(record).strip('"')


async def get_domain_ips(domain: str) -> List[str]:
    """Resolve IPv4 and IPv6 addresses for a hostname."""
    resolver = _resolver()
    (a_records, _), (aaaa_records, _) = await asyncio.gather(
        _resolve(resolver, domain, "A"),
        _resolve(resolver, domain, "AAAA"),
    )
    return [str(record) for record in (*a_records, *aaaa_records)]


async def get_dns_records(
    domain: str, dkim_selectors: Optional[Iterable[str]] = None
) -> Dict[str, Any]:
    """Retrieve web, mail, security, and delegation DNS data for a domain."""
    resolver = _resolver()
    selectors = tuple(dict.fromkeys(dkim_selectors or DEFAULT_DKIM_SELECTORS))

    queries = {
        "NS": (domain, "NS"),
        "MX": (domain, "MX"),
        "A": (domain, "A"),
        "AAAA": (domain, "AAAA"),
        "TXT": (domain, "TXT"),
        "CNAME_WWW": (f"www.{domain}", "CNAME"),
        "CAA": (domain, "CAA"),
        "SOA": (domain, "SOA"),
        "DMARC": (f"_dmarc.{domain}", "TXT"),
        "MTA_STS": (f"_mta-sts.{domain}", "TXT"),
        "TLS_RPT": (f"_smtp._tls.{domain}", "TXT"),
        "DNSKEY": (domain, "DNSKEY"),
        "DS": (domain, "DS"),
    }
    for selector in selectors:
        queries[f"DKIM:{selector}"] = (f"{selector}._domainkey.{domain}", "TXT")

    results = await asyncio.gather(
        *(_resolve(resolver, name, record_type) for name, record_type in queries.values())
    )
    resolved = dict(zip(queries, results))
    errors = {
        key: error
        for key, (_, error) in resolved.items()
        if error not in (None, "NO_ANSWER")
    }

    ns_records = resolved["NS"][0]
    ns_hosts = [str(record).rstrip(".") for record in ns_records]
    ns_ips = await asyncio.gather(*(get_domain_ips(host) for host in ns_hosts))

    mx_records = resolved["MX"][0]
    soa_records = resolved["SOA"][0]
    caa_records = resolved["CAA"][0]
    dnskey_present = bool(resolved["DNSKEY"][0])
    ds_present = bool(resolved["DS"][0])

    if dnskey_present and ds_present:
        dnssec_status = "signed"
    elif dnskey_present:
        dnssec_status = "dnskey_without_ds"
    elif ds_present:
        dnssec_status = "ds_without_dnskey"
    else:
        dnssec_status = "unsigned"

    dkim = {
        selector: [_txt_value(record) for record in resolved[f"DKIM:{selector}"][0]]
        for selector in selectors
        if resolved[f"DKIM:{selector}"][0]
    }

    soa = None
    if soa_records:
        record = soa_records[0]
        soa = {
            "mname": str(record.mname),
            "rname": str(record.rname),
            "serial": record.serial,
            "refresh": record.refresh,
            "retry": record.retry,
            "expire": record.expire,
            "minimum": record.minimum,
        }

    records: Dict[str, Any] = {
        "NS": [
            {"nameserver": str(record), "ips": ips}
            for record, ips in zip(ns_records, ns_ips)
        ],
        "MX": [
            {"priority": record.preference, "mail_server": str(record.exchange)}
            for record in mx_records
        ],
        "A": [str(record) for record in resolved["A"][0]],
        "AAAA": [str(record) for record in resolved["AAAA"][0]],
        "TXT": [_txt_value(record) for record in resolved["TXT"][0]],
        "CNAME_WWW": [str(record) for record in resolved["CNAME_WWW"][0]],
        "CAA": [
            {
                "flags": record.flags,
                "tag": record.tag.decode() if isinstance(record.tag, bytes) else str(record.tag),
                "value": record.value.decode() if isinstance(record.value, bytes) else str(record.value),
            }
            for record in caa_records
        ],
        "SOA": soa,
        "DMARC": [_txt_value(record) for record in resolved["DMARC"][0]],
        "MTA_STS": [_txt_value(record) for record in resolved["MTA_STS"][0]],
        "TLS_RPT": [_txt_value(record) for record in resolved["TLS_RPT"][0]],
        "DKIM": dkim,
        "DNSSEC": {
            "status": dnssec_status,
            "dnskey_present": dnskey_present,
            "ds_present": ds_present,
            "note": "Presence check only; cryptographic validation is not performed.",
        },
        "lookup_errors": errors,
    }
    records["diagnostics"] = build_diagnostics(records)
    return records


def build_diagnostics(records: Dict[str, Any]) -> List[Dict[str, str]]:
    diagnostics: List[Dict[str, str]] = []

    def add(severity: str, code: str, message: str) -> None:
        diagnostics.append({"severity": severity, "code": code, "message": message})

    def resolver_failed(record_type: str) -> bool:
        error = records["lookup_errors"].get(record_type, "")
        return error in ("TIMEOUT", "NO_NAMESERVERS") or error.startswith("ERROR:")

    if records["lookup_errors"].get("NS") == "NXDOMAIN":
        add("error", "domain_not_found", "The domain does not exist (NXDOMAIN).")
        return diagnostics

    spf = [value for value in records["TXT"] if value.lower().startswith("v=spf1")]
    if len(spf) > 1:
        add("error", "multiple_spf", "Multiple SPF records were found; SPF evaluation will fail.")
    elif not spf and not resolver_failed("TXT"):
        add("warning", "missing_spf", "No SPF policy was found at the domain apex.")

    if not records["MX"] and not resolver_failed("MX"):
        add("warning", "missing_mx", "No MX record was found.")
    elif any(record["mail_server"] == "." for record in records["MX"]):
        add("info", "null_mx", "The domain publishes a null MX and does not accept email.")

    if not records["DMARC"] and not resolver_failed("DMARC"):
        add("warning", "missing_dmarc", "No DMARC policy was found.")
    elif len(records["DMARC"]) > 1:
        add("error", "multiple_dmarc", "Multiple DMARC records were found.")

    if records["DNSSEC"]["status"] == "dnskey_without_ds":
        add("warning", "dnssec_incomplete", "DNSKEY exists but no DS delegation was found.")
    elif records["DNSSEC"]["status"] == "ds_without_dnskey":
        add("error", "dnssec_broken", "A DS delegation exists but no DNSKEY was returned.")

    failed_types = [
        record_type for record_type in records["lookup_errors"]
        if resolver_failed(record_type)
    ]
    if failed_types:
        add("warning", "dns_lookup_failure", f"Resolver failure for: {', '.join(failed_types)}.")

    return diagnostics


async def get_ptr_record(ip_address: str) -> Optional[str]:
    """Resolve the first PTR record for an IP address."""
    resolver = _resolver()
    reverse_name = dns.reversename.from_address(ip_address)
    records, _ = await _resolve(resolver, str(reverse_name), "PTR")
    return str(records[0]).rstrip(".") if records else None
