from fastapi import FastAPI, HTTPException
from typing import Dict, List, Optional
import dns.resolver
import requests
import ipaddress

from dns_lookup import get_dns_records, get_domain_ips, get_ptr_record
from ip_info import get_ip_info
from geoip_updater import start_background_updater

app = FastAPI(
    title="DNS Lookup API",
    description="API for retrieving DNS records and IP geolocation information",
    version="1.0.0"
)

# Start background GeoIP updater thread
start_background_updater(interval_hours=24)

@app.get("/")
async def root():
    return {"message": "DNS Lookup API is running. Use /dns-lookup/{domain} to get DNS information."}

@app.get("/dns-lookup/{domain}")
async def dns_lookup(domain: str) -> Dict:
    """
    Retrieve DNS records for a domain including nameservers, MX, A, TXT records,
    www CNAME, and IP provider/location information for A records.
    """
    try:
        records = await get_dns_records(domain)
        
        # Add IP geolocation information for A records
        if "A" in records and records["A"]:
            ip_info_list = []

            for ip in records["A"]:
                try:
                    # Validate IP address
                    ipaddress.ip_address(ip)
                    ip_info = get_ip_info(ip)
                    # Get PTR record for the IP
                    ptr_record = await get_ptr_record(ip)
                    # Handle potential errors from MaxMind
                    if "error" in ip_info:
                        ip_info_list.append({
                            "ip": ip,
                            "ptr": ptr_record,
                            "provider": "Unknown",
                            "location": "Unknown",
                            "coordinates": {"latitude": None, "longitude": None}
                        })
                    else:
                        # Parse coordinates
                        coords = ip_info.get("coordinates", "Unknown,Unknown")
                        lat, lon = coords.split(",") if "," in coords else (None, None)
                        ip_info_list.append({
                            "ip": ip,
                            "ptr": ptr_record,
                            "provider": ip_info.get("org", "Unknown"),
                            "location": f"{ip_info.get('city', 'Unknown')}, {ip_info.get('region', 'Unknown')}, {ip_info.get('country', 'Unknown')}",
                            "coordinates": {
                                "latitude": lat if lat != "Unknown" else None,
                                "longitude": lon if lon != "Unknown" else None
                            }
                        })
                except ValueError:
                    # Not a valid IP address
                    ip_info_list.append({
                        "ip": ip,
                        "ptr": None,
                        "provider": "Invalid IP",
                        "location": "N/A",
                        "coordinates": {"latitude": None, "longitude": None}
                    })

            records["A_IP_Info"] = ip_info_list
        else:
            records["A_IP_Info"] = []
            
        # Add IP information for MX records
        if "MX" in records and records["MX"]:
            for mx_record in records["MX"]:
                mx_domain = mx_record["mail_server"].rstrip('.')
                mx_ips = await get_domain_ips(mx_domain)
                mx_record["ips"] = mx_ips
                # Add IP geolocation info for MX record IPs
                mx_ip_info_list = []
                for ip in mx_ips:
                    try:
                        ipaddress.ip_address(ip)
                        ip_info = get_ip_info(ip)
                        # Handle potential errors from MaxMind
                        if "error" in ip_info:
                            mx_ip_info_list.append({
                                "ip": ip,
                                "provider": "Unknown",
                                "location": "Unknown",
                                "coordinates": {"latitude": None, "longitude": None}
                            })
                        else:
                            # Parse coordinates
                            coords = ip_info.get("coordinates", "Unknown,Unknown")
                            lat, lon = coords.split(",") if "," in coords else (None, None)
                        mx_ip_info_list.append({
                            "ip": ip,
                            "provider": ip_info.get("org", "Unknown"),
                            "location": f"{ip_info.get('city', 'Unknown')}, {ip_info.get('region', 'Unknown')}, {ip_info.get('country', 'Unknown')}",
                            "coordinates": {
                                "latitude": lat if lat != "Unknown" else None,
                                "longitude": lon if lon != "Unknown" else None
                            }
                        })
                    except ValueError:
                        mx_ip_info_list.append({
                            "ip": ip,
                            "provider": "Invalid IP",
                            "location": "N/A",
                            "coordinates": {"latitude": None, "longitude": None}
                        })
                    mx_record["ip_info"] = mx_ip_info_list
        else:
            records["MX"] = []
        
        # Add IP information for CNAME_WWW records
        if "CNAME_WWW" in records and records["CNAME_WWW"]:
            cname_with_ips = []
            for cname in records["CNAME_WWW"]:
                cname_domain = cname.rstrip('.')
                cname_ips = await get_domain_ips(cname_domain)
                cname_with_ips.append({
                    "cname": cname,
                    "ips": cname_ips
                })
            records["CNAME_WWW"] = cname_with_ips
        
        return {"domain": domain, "records": records}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error retrieving DNS records: {str(e)}")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
