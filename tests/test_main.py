import ipaddress

import pytest
from fastapi import HTTPException

import main


def test_normalize_ipv4_as_ip():
    normalized, address = main._normalize_target("8.8.8.8")

    assert normalized == "8.8.8.8"
    assert address == ipaddress.ip_address("8.8.8.8")


def test_normalize_idn_domain():
    normalized, address = main._normalize_target("BÜCHER.example.")

    assert normalized == "xn--bcher-kva.example"
    assert address is None


@pytest.mark.parametrize("value", ["localhost", "-bad.example", "bad..example"])
def test_invalid_domains_are_rejected(value):
    with pytest.raises(HTTPException) as error:
        main._normalize_target(value)

    assert error.value.status_code == 422


def test_dkim_selector_limit_and_validation():
    assert list(main._parse_selectors("google,s1")) == ["google", "s1"]
    with pytest.raises(HTTPException):
        main._parse_selectors("bad.selector")


@pytest.mark.asyncio
async def test_direct_ipv6_lookup_does_not_do_domain_dns(monkeypatch):
    async def fake_enrich(ip, include_ptr=False):
        return {"ip": ip, "ptr": "ptr.example", "provider": "Test", "location": "Test"}

    monkeypatch.setattr(main, "_enrich_ip", fake_enrich)
    result = await main.dns_lookup("2001:4860:4860::8888", None)

    assert result["records"]["A"] == []
    assert result["records"]["AAAA"] == ["2001:4860:4860::8888"]
    assert result["records"]["DNSSEC"]["status"] == "not_applicable"
