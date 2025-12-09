import dns.resolver
import asyncio
from typing import Dict, List

async def get_domain_ips(domain: str) -> List[str]:
    """
    Resolve IP addresses for a domain.
    """
    try:
        a_records = dns.resolver.resolve(domain, 'A')
        return [str(a) for a in a_records]
    except Exception:
        return []

async def get_dns_records(domain: str) -> Dict:
    """
    Retrieve all DNS records for a domain including nameservers, MX, A, TXT records, and www CNAME.
    """
    records = {}
    
    # Get nameservers (NS records) with their IP addresses
    try:
        ns_records = dns.resolver.resolve(domain, 'NS')
        ns_list = []
        for ns in ns_records:
            ns_domain = str(ns)
            ns_ips = await get_domain_ips(ns_domain.rstrip('.'))
            ns_list.append({
                "nameserver": ns_domain,
                "ips": ns_ips
            })
        records['NS'] = ns_list
    except Exception as e:
        records['NS'] = []
    
    # Get MX records
    try:
        mx_records = dns.resolver.resolve(domain, 'MX')
        records['MX'] = [{"priority": mx.preference, "mail_server": str(mx.exchange)} for mx in mx_records]
    except Exception as e:
        records['MX'] = []
    
    # Get A records
    try:
        a_records = dns.resolver.resolve(domain, 'A')
        records['A'] = [str(a) for a in a_records]
    except Exception as e:
        records['A'] = []
    
    # Get TXT records
    try:
        txt_records = dns.resolver.resolve(domain, 'TXT')
        records['TXT'] = [str(txt) for txt in txt_records]
    except Exception as e:
        records['TXT'] = []
    
    # Get www CNAME record
    try:
        www_domain = f"www.{domain}"
        cname_records = dns.resolver.resolve(www_domain, 'CNAME')
        records['CNAME_WWW'] = [str(cname) for cname in cname_records]
    except Exception as e:
        records['CNAME_WWW'] = []
    
    return records
