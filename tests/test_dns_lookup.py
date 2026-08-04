from dns_lookup import build_diagnostics


def base_records():
    return {
        "TXT": ["v=spf1 -all"],
        "MX": [{"priority": 10, "mail_server": "mail.example.com."}],
        "DMARC": ["v=DMARC1; p=reject"],
        "DNSSEC": {"status": "signed"},
        "lookup_errors": {},
    }


def test_healthy_mail_records_have_no_diagnostics():
    assert build_diagnostics(base_records()) == []


def test_duplicate_spf_and_missing_dmarc_are_reported():
    records = base_records()
    records["TXT"] = ["v=spf1 -all", "v=spf1 include:example.net -all"]
    records["DMARC"] = []

    codes = {item["code"] for item in build_diagnostics(records)}

    assert codes == {"multiple_spf", "missing_dmarc"}


def test_incomplete_dnssec_is_reported():
    records = base_records()
    records["DNSSEC"]["status"] = "dnskey_without_ds"

    assert build_diagnostics(records)[0]["code"] == "dnssec_incomplete"
