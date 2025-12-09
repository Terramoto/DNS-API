# DNS Lookup API

A FastAPI-based REST API for retrieving DNS records and IP geolocation information for any domain.

## Browser Extension

A Greasemonkey/Tampermonkey userscript is available that allows you to select domains or IPs on any webpage and retrieve DNS information through this API service. See [USERSCRIPT_README.md](USERSCRIPT_README.md) for installation and usage instructions.

## Features

This API provides lookup capabilities for:
- Nameservers (NS records) with IP addresses
- MX records (Mail exchange) with IP addresses
- A records (IPv4 addresses) with provider and location information
- TXT records
- www CNAME record with IP addresses
- IP provider and location information for all IP addresses

## Requirements

- Python 3.7+
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

### GET /dns-lookup/{domain}

Retrieves all DNS records for the specified domain.

**Path Parameters:**
- `domain` (string, required): The domain name to look up

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

The API will return appropriate HTTP status codes and error messages for invalid domains or DNS lookup failures.

## Implementation Details

The API uses:
- `dnspython` for DNS record lookups
- `MaxMind GeoLite2` databases for IP geolocation data
- `FastAPI` for the web framework
