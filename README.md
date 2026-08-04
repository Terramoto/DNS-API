# DNS Lookup API

A FastAPI-based REST API for retrieving DNS records and IP geolocation information for any domain.
I did this for IT work, it helps find domains details without having to go to other websites or use tools.

## Browser Extension

A Violentmonkey userscript is available that allows you to select domains or IPs on any webpage and retrieve DNS information through this API service.

The userscript can also search the configured WHMCS staff interface. Searches made with a
client email address are cached in Violentmonkey's private storage for seven days. Cached
results include a **Refresh** action to bypass the cache and replace the saved entry.

Before installing the userscript, set `WHMCS_ROOT`, `API_URL`, and the matching userscript
`@connect` host entries in `violentmonkey.js`. Common DKIM selectors can be configured in
the `DKIM_SELECTORS` constant.

## Features

This API provides lookup capabilities for:
- Nameservers (NS records) with IP addresses
- MX records (Mail exchange) with IP addresses
- A records (IPv4 addresses) with provider and location information
- AAAA records (IPv6 addresses) with provider and location information
- TXT records
- www CNAME record with IP addresses
- IP provider and location information for all IP addresses
- PTR record for the A record IP
- CAA and SOA records
- SPF and DMARC diagnostics
- DKIM discovery for configurable selectors
- MTA-STS and SMTP TLS reporting records
- DNSSEC DS/DNSKEY presence status
- Warnings for missing/duplicate mail policies and unresolved MX targets

## Requirements

- Python 3.9+
- FastAPI
- dnspython
- requests

## Installation

1. Clone this repository
2. Install the required packages:
   ```bash
   pip install -r requirements.txt
   ```

## Usage

1. Start the API server:
   ```bash
   python main.py
   ```

2. The API will be available at `http://localhost:8000`

3. Access the API documentation at `http://localhost:8000/docs`

## API Endpoints

### GET /

Returns a welcome message and basic API information.

### GET /dns-lookup/{domain_or_ip}

Retrieves DNS records and mail diagnostics for a domain, or GeoIP/PTR information for an IP.

**Path Parameters:**
- `domain_or_ip` (string, required): Domain name, IPv4 address, or IPv6 address
- `dkim_selectors` (query string, optional): Comma-separated DKIM selectors, maximum 10

**Response:**
```json
{
  "domain": "example.com",
  "records": {
    "NS": [
      {
        "nameserver": "a.iana-servers.net.",
        "ips": ["199.43.135.53"]
      },
      {
        "nameserver": "b.iana-servers.net.",
        "ips": ["199.43.133.53"]
      }
    ],
    "MX": [
      {
        "priority": 0,
        "mail_server": ".",
        "ips": [],
        "ip_info": []
      }
    ],
    "A": ["23.192.228.80"],
    "TXT": ["\"v=spf1 -all\""],
    "CNAME_WWW": [
      {
        "cname": "www.example.com-v4.edgesuite.net.",
        "ips": ["2.23.103.8", "2.23.103.24"]
      }
    ],
    "A_IP_Info": [
      {
        "ip": "23.192.228.80",
        "provider": "AS20940 Akamai International B.V.",
        "location": "San Jose, California, US",
        "coordinates": {
          "latitude": "37.3394",
          "longitude": "-121.8950"
        }
      }
    ]
  }
}
```

## Error Handling

The API returns a validation error for invalid targets and reserves HTTP 500 for unexpected server failures.

Individual DNS lookup failures are also returned in `records.lookup_errors`, allowing a
client to distinguish missing records from timeouts, NXDOMAIN, and resolver failures.

## Development checks

```bash
pip install -r requirements-dev.txt
pytest -q
node --check violentmonkey.js
```

## Implementation Details

The API uses:
- `dnspython` for DNS record lookups
- `MaxMind GeoLite2` databases for IP geolocation data  ( https://github.com/P3TERX/GeoLite.mmdb )
- `FastAPI` for the web framework
