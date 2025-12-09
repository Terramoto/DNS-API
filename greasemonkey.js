// ==UserScript==
// @name         Domain/IP Information Lookup
// @namespace    http://tampermonkey.net/
// @version      2.5
// @description  Detects selected domains or IPs and displays a floating panel with DNS and GeoIP information using an external API.
// @author       Terramoto
// @match        *://*/*
// @grant        GM.xmlHttpRequest
// @grant        GM_xmlHttpRequest
// @connect      localhost:8000
// @connect      127.0.0.1:8000
// @run-at       document-end
// ==/UserScript==

(function () {
    'use strict';

    // --- Configuration ---
    // API URL is set to use the explicit IP and Port 8000 to match the @connect directives above.
    const API_URL = 'http://127.0.0.1:8000/dns-lookup/';
    let lookupPanel = null;

    // --- Utility Functions ---
    // Simple check for valid domain name (RFC 1035 format, not perfect but good enough)
    const domainRegex = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9][a-z0-9-]{0,61}[a-z0-9]$/i;

    // Simple check for IPv4 address
    const ipRegex = /^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/;

    function isValidTarget(text) {
        // Trim whitespace and check against regex patterns
        const trimmed = text.trim();
        if (!trimmed) return null;

        // Check if the trimmed text is a valid domain or IP
        const isDomain = domainRegex.test(trimmed);
        const isIP = ipRegex.test(trimmed);

        if (isDomain) {
            return { type: 'domain', value: trimmed };
        } else if (isIP) {
            return { type: 'ip', value: trimmed };
        }
        return null;
    }

    function createPanel() {
        // Create the main container for the panel
        lookupPanel = document.createElement('div');
        lookupPanel.id = 'gm-domain-info-panel';
        lookupPanel.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            width: 350px;
            max-height: 80vh;
            background-color: #333;
            color: #f4f4f4;
            border-radius: 8px;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
            z-index: 99999;
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            font-size: 14px;
            transition: opacity 0.3s, transform 0.3s;
            transform: translateX(100%);
            opacity: 0;
            display: flex;
            flex-direction: column;
            overflow: hidden;
        `;
        document.body.appendChild(lookupPanel);
    }

    function showPanel(target, data) {
        if (!lookupPanel) {
            createPanel();
        }

        // --- Panel Content Structure ---
        lookupPanel.innerHTML = `
            <div id="gm-panel-header" style="padding: 12px; background-color: #007acc; color: white; border-top-left-radius: 8px; border-top-right-radius: 8px; display: flex; justify-content: space-between; align-items: center;">
                <strong style="font-size: 16px;">Lookup: ${target.value}</strong>
                <button id="gm-close-btn" style="background: none; border: none; color: white; font-size: 18px; cursor: pointer; padding: 0 5px; line-height: 1;">&times;</button>
            </div>
            <div id="gm-panel-body" style="padding: 15px; overflow-y: auto;">
                ${generateContentHTML(data)}
            </div>
        `;

        // Attach close handler
        document.getElementById('gm-close-btn').addEventListener('click', hidePanel);

        // Animate panel into view
        setTimeout(() => {
            lookupPanel.style.transform = 'translateX(0)';
            lookupPanel.style.opacity = '1';
        }, 10); // Small delay for smooth transition
    }

    function hidePanel() {
        if (lookupPanel) {
            lookupPanel.style.transform = 'translateX(100%)';
            lookupPanel.style.opacity = '0';
            // Remove content after animation
            setTimeout(() => {
                lookupPanel.innerHTML = '';
            }, 300);
        }
    }

    function generateContentHTML(data) {
        const typeBadge = data.isDomain ? '<span style="background-color: #28a745; padding: 3px 8px; border-radius: 4px; font-size: 12px; font-weight: bold;">DOMAIN</span>' : '<span style="background-color: #ffc107; color: #333; padding: 3px 8px; border-radius: 4px; font-size: 12px; font-weight: bold;">IP ADDRESS</span>';

        let ipInfoHtml = '';

        if (data.isDomain && data.ip_geo_details.length > 0) {
            // Case 1: Domain Lookup with multiple A records / GeoIP entries

            // 1. List all resolved A Records
            ipInfoHtml += `
                <div style="border-left: 3px solid #007acc; padding-left: 10px; margin-bottom: 15px;">
                    <h4 style="margin: 0 0 5px 0; color: #4dcfff; font-size: 14px;">Resolved A Records</h4>
                    ${data.a_records.map(ip => `<p style="margin: 3px 0;"><strong style="color: #ccc;">A Record:</strong> ${ip}</p>`).join('')}
                </div>
            `;

            // 2. Display GeoIP details for each resolved IP
            data.ip_geo_details.forEach((ipDetail, index) => {
                ipInfoHtml += `
                    <div style="border-left: 3px solid #28a745; padding-left: 10px; margin-bottom: 15px;">
                        <h4 style="margin: 0 0 5px 0; color: #4dcfff; font-size: 14px;">IP Information (GeoIP ${index + 1})</h4>
                        <p style="margin: 3px 0;"><strong style="color: #ccc;">IP Address:</strong> ${ipDetail.ip || 'N/A'}</p>
                        <!-- Subnet (CIDR) removed as requested -->
                        <p style="margin: 3px 0;"><strong style="color: #ccc;">Provider:</strong> ${ipDetail.provider || 'N/A'}</p>
                        <p style="margin: 3px 0;"><strong style="color: #ccc;">Location:</strong> ${ipDetail.location || 'N/A'}</p>
                    </div>
                `;
            });

        } else if (data.isDomain && data.a_records.length === 0) {
            // Case 2: Domain Lookup failed to resolve A record
            ipInfoHtml += `
                <div style="border-left: 3px solid #e74c3c; padding-left: 10px; margin-bottom: 15px;">
                    <h4 style="margin: 0 0 5px 0; color: #e74c3c; font-size: 14px;">IP Information (GeoIP)</h4>
                    <p style="margin: 3px 0;"><strong style="color: #ccc;">A Record:</strong> N/A (No A record found)</p>
                    <!-- Subnet (CIDR) removed as requested -->
                    <p style="margin: 3px 0;"><strong style="color: #ccc;">Provider:</strong> N/A</p>
                    <p style="margin: 3px 0;"><strong style="color: #ccc;">Location:</strong> N/A</p>
                </div>
            `;
        } else {
            // Case 3: IP Lookup (Single IP)
            ipInfoHtml += `
                <div style="border-left: 3px solid #007acc; padding-left: 10px; margin-bottom: 15px;">
                    <h4 style="margin: 0 0 5px 0; color: #4dcfff; font-size: 14px;">IP Information (GeoIP)</h4>
                    <p style="margin: 3px 0;"><strong style="color: #ccc;">IP Address:</strong> ${data.ip_address || 'N/A'}</p>
                    <!-- Subnet (CIDR) removed as requested -->
                    <p style="margin: 3px 0;"><strong style="color: #ccc;">Provider:</strong> ${data.ip_provider || 'N/A'}</p>
                    <p style="margin: 3px 0;"><strong style="color: #ccc;">Location:</strong> ${data.ip_location || 'N/A'}</p>
                </div>
            `;
        }

        // --- Combined HTML structure ---
        let html = `
            <div style="margin-bottom: 15px; display: flex; justify-content: space-between; align-items: center;">
                ${typeBadge}
                <div style="font-size: 11px; color: #aaa;">Data from API</div>
            </div>
            ${ipInfoHtml}
        `;

        if (data.isDomain) {
            html += `
                <h4 style="margin: 15px 0 8px 0; color: #4dcfff; border-bottom: 1px solid #444; padding-bottom: 5px; font-size: 14px;">DNS Records</h4>
                ${createRecordSection('Nameservers (NS)', data.ns)}
                ${createRecordSection('Mail Exchange (MX)', data.mx)}
                ${createRecordSection('Canonical Name (CNAME)', data.cname)}
                ${createRecordSection('Sender Policy (SPF/TXT)', data.spf)}
            `;
        }

        return html;
    }

    function createRecordSection(title, records) {
        if (!records || records.length === 0 || (Array.isArray(records) && records.length === 0)) {
            return `<p style="margin: 5px 0 15px 0;"><strong style="color: #ccc;">${title}:</strong> <span style="color: #e74c3c;">None Found</span></p>`;
        }

        let listItems;

        // Specific formatting for NS records to include IPs
        if (title === 'Nameservers (NS)') {
            // Records is an array of objects: [{ nameserver: '...', ips: [...] }]
            listItems = records.map(record => {
                const ips = record.ips && record.ips.length > 0 ? ` (${record.ips.join(', ')})` : '';
                return `<li style="margin-left: 15px; text-indent: -15px; color: #ccc;">
                    <span style="color: #007acc;">&bull;</span> ${record.nameserver}${ips}
                </li>`;
            }).join('');
        } else {
            // Handle all other records (MX, CNAME, SPF/TXT) which are expected to be simple string arrays
            listItems = records.map(record => `<li style="margin-left: 15px; text-indent: -15px; color: #ccc;">
                    <span style="color: #007acc;">&bull;</span> ${record}
                </li>`
            ).join('');
        }

        return `
            <p style="margin: 5px 0 5px 0;"><strong style="color: #ccc;">${title}:</strong></p>
            <ul style="list-style: none; padding-left: 0; margin: 0 0 15px 0; font-size: 13px;">
                ${listItems}
            </ul>
        `;
    }

    // --- API Fetching Logic (using GM_xmlHttpRequest) ---
    // The preferred modern function wrapper
    let GM_XHR;
    if (typeof GM_xmlHttpRequest !== 'undefined') {
        GM_XHR = GM_xmlHttpRequest;
    } else if (typeof GM.xmlHttpRequest !== 'undefined') {
        GM_XHR = GM.xmlHttpRequest;
    } else {
        // Fallback to regular XMLHttpRequest for environments without GM_XHR
        GM_XHR = function (options) {
            console.warn("[Domain Lookup] Using fallback XMLHttpRequest - this may not work due to CORS restrictions");
            const xhr = new XMLHttpRequest();
            xhr.open(options.method, options.url, true);
            xhr.timeout = options.timeout || 0;
            xhr.onload = function () {
                if (options.onload) options.onload({ responseText: xhr.responseText, status: xhr.status });
            };
            xhr.onerror = function () {
                if (options.onerror) options.onerror({ status: xhr.status });
            };
            xhr.send();
        };
    }

    function fetchDNSInfo(target) {
        // Show loading state immediately
        showPanel(target, {
            isDomain: target.type === 'domain',
            ip_geo_details: [],
            a_records: target.type === 'domain' ? ['Loading...'] : [],
            ip_address: target.type === 'ip' ? 'Loading...' : 'N/A',
            // Removed ip_subnet from initial loading state
            ip_provider: 'Loading...',
            ip_location: 'Loading...'
        });

        const lookupUrl = API_URL + target.value;

        // --- REAL GM_xmlHttpRequest IMPLEMENTATION ---
        GM_XHR({
            method: "GET",
            url: lookupUrl,
            timeout: 10000,
            onload: function (response) {
                if (!response.responseText || response.responseText.trim() === '') {
                    console.error("[Domain Lookup] API returned an empty response.");
                    // Removed ip_subnet from error data construction
                    const errorData = { isDomain: target.type === 'domain', a_records: target.type === 'domain' ? ['Error'] : [], ip_geo_details: [], ip_provider: 'Empty Response', ip_location: 'Server likely returned no data.', ns: [], mx: [], cname: [], spf: [], ip_address: 'N/A' };
                    showPanel(target, errorData);
                    return;
                }

                try {
                    const data = JSON.parse(response.responseText);
                    const ipGeoDetails = data.records.A_IP_Info || [];

                    let parsedData = {
                        isDomain: target.type === 'domain',

                        // A Records are used for display in the GeoIP section for domains
                        a_records: data.records.A || [],

                        // ip_geo_details contains the GeoIP data for all IPs
                        ip_geo_details: ipGeoDetails,

                        // NS records store the full objects for IP display
                        ns: data.records.NS || [],

                        // Other records remain mapped to simple strings
                        mx: data.records.MX?.map(mx => `${mx.mail_server} (Priority ${mx.priority})`) || [],
                        cname: data.records.CNAME_WWW?.map(cname => cname.cname || cname) || [],
                        spf: data.records.TXT?.filter(txt => txt.includes('v=spf1')) || [],
                    };

                    // For IP lookups, we populate the single-IP fields from the first entry
                    if (!parsedData.isDomain) {
                        const ipInfo = ipGeoDetails[0];
                        parsedData.ip_address = ipInfo?.ip || target.value;
                        // Removed parsedData.ip_subnet assignment
                        parsedData.ip_provider = ipInfo?.provider || 'N/A';
                        parsedData.ip_location = ipInfo?.location || 'N/A';
                    } else {
                        // Set defaults for domain lookups, as these fields are not used in the display logic for domains
                        parsedData.ip_address = 'N/A';
                        // Removed parsedData.ip_subnet assignment
                        parsedData.ip_provider = 'N/A';
                        parsedData.ip_location = 'N/A';
                    }

                    showPanel(target, parsedData);

                } catch (e) {
                    console.error('Error parsing API response. Error:', e);
                    // Removed ip_subnet from error data construction
                    const errorData = { isDomain: target.type === 'domain', a_records: target.type === 'domain' ? ['Parsing Error'] : [], ip_geo_details: [], ip_provider: 'Returned Non-JSON', ip_location: 'Check console for raw response text.', ns: [], mx: [], cname: [], spf: [], ip_address: 'N/A' };
                    showPanel(target, errorData);
                }
            },
            onerror: function (response) {
                console.error("[Domain Lookup] GM_xmlHttpRequest FAILED. Status:", response.status, "Details:", response);
                // Removed ip_subnet from error data construction
                const errorData = { isDomain: target.type === 'domain', a_records: target.type === 'domain' ? ['GM_XHR Failed'] : [], ip_geo_details: [], ip_provider: 'Network/Security Error', ip_location: `Status: ${response.status}. See console.`, ns: [], mx: [], cname: [], spf: [], ip_address: 'N/A' };
                showPanel(target, errorData);
            },
            ontimeout: function () {
                console.error("[Domain Lookup] GM_xmlHttpRequest TIMEOUT FIRED.");
                // Removed ip_subnet from error data construction
                const errorData = { isDomain: target.type === 'domain', a_records: target.type === 'domain' ? ['Timeout (10s)'] : [], ip_geo_details: [], ip_provider: 'Request Timed Out', ip_location: 'Server took too long to respond.', ns: [], mx: [], cname: [], spf: [], ip_address: 'N/A' };
                showPanel(target, errorData);
            }
        });
    }

    // --- Main Event Listener ---
    document.addEventListener('mouseup', function (event) {
        const selection = window.getSelection();
        if (selection.rangeCount > 0) {
            // Trim and sanitize the selected text
            const selectedText = selection.toString().trim();
            const target = isValidTarget(selectedText);

            // Check if the selected text is a valid target
            if (target) {
                // Prevent the panel from closing immediately if a valid selection is made
                event.stopPropagation();
                fetchDNSInfo(target);
            } else {
                // If a selection is made but it's not a domain/IP, hide the existing panel
                hidePanel();
            }
        }
    });

    // Handle clicks outside the panel to close it
    document.addEventListener('mousedown', function (event) {
        if (lookupPanel && lookupPanel.contains(event.target)) {
            // Clicked inside the panel, do nothing
            return;
        }

        if (lookupPanel && lookupPanel.style.opacity === '1') {
            hidePanel();
        }
    });

    // Initialize the panel element
    createPanel();
})();