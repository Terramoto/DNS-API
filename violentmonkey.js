// ==UserScript==
// @name         Domain/IP/WHMCS Information Lookup
// @namespace    http://terramoto.xyz/
// @version      2.5
// @description  Detects selected domains or IPs and displays a floating panel with DNS and GeoIP information using an external API.
// @author       Terramoto
// @match        *://*/*
// @grant        GM.xmlHttpRequest
// @grant        GM_xmlHttpRequest
// @connect      localhost:8000
// @connect      127.0.0.1:8000
// @connect      your.domain.here
// @run-at       document-end
// ==/UserScript==

(function () {
    'use strict';

    // --- Configuration ---
    // API URL is set to use the explicit IP and Port 8000 to match the @connect directives above.
    const API_URL = 'http://dns.terramoto.xyz/dns-lookup/';
    // Fill in with your WHMCS staff base url
    const WHMCS_ROOT = '';
    const WHMCS_API_URL = `${WHMCS_ROOT}search/intellisearch`;
    let lookupPanel = null;
    let activeTab = 'dns';
    let whmcsToken = null;

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

    function extractWHMCSToken() {
        // Method 1: JavaScript global variable (most reliable)
        if (typeof window.csrfToken !== 'undefined' && window.csrfToken) {
            return window.csrfToken;
        }

        // Method 2: Hidden form input with name="token"
        const tokenInput = document.querySelector('input[name="token"]');
        if (tokenInput && tokenInput.value) {
            return tokenInput.value;
        }

        // Method 3: Any hidden input with name containing "token"
        const genericTokenInput = document.querySelector('input[type="hidden"][name*="token"]');
        if (genericTokenInput && genericTokenInput.value) {
            return genericTokenInput.value;
        }

        // No token found
        return null;
    }

    function fetchFreshWHMCSToken(callback) {
        console.log('[WHMCS] Fetching fresh token from WHMCS page...');

        GM_XHR({
            method: 'GET',
            url: WHMCS_ROOT,
            timeout: 10000,
            onload: function (response) {
                try {
                    const htmlContent = response.responseText;

                    // Extract token from the HTML using regex
                    // Looking for: csrfToken="token_value"
                    const tokenMatch = htmlContent.match(/csrfToken\s*=\s*["']([a-f0-9]{40})["']/i);

                    if (tokenMatch && tokenMatch[1]) {
                        const token = tokenMatch[1];
                        console.log('[WHMCS] Fresh token extracted successfully');
                        callback(token);
                    } else {
                        console.error('[WHMCS] Could not find token in HTML response');
                        callback(null);
                    }
                } catch (e) {
                    console.error('[WHMCS] Error parsing HTML response:', e);
                    callback(null);
                }
            },
            onerror: function (response) {
                console.error('[WHMCS] Failed to fetch WHMCS page:', response);
                callback(null);
            },
            ontimeout: function () {
                console.error('[WHMCS] Timeout while fetching WHMCS page');
                callback(null);
            }
        });
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

    function showPanel(target, dnsData, whmcsData = null) {
        if (!lookupPanel) {
            createPanel();
        }

        // Generate WHMCS content (loading state or actual data)
        let whmcsContentHTML = '';
        if (whmcsData === null) {
            // Initial loading state
            whmcsContentHTML = `
                <div style="text-align: center; padding: 40px; color: #aaa;">
                    <div style="font-size: 18px; margin-bottom: 10px;">Searching WHMCS...</div>
                    <div style="font-size: 14px;">Please wait</div>
                </div>
            `;
        } else if (whmcsData === 'NO_TOKEN') {
            // Token not found
            whmcsContentHTML = `
                <div style="text-align: center; padding: 40px; color: #e74c3c;">
                    <div style="font-size: 18px; margin-bottom: 10px;">Token Not Found</div>
                    <div style="font-size: 14px;">Please ensure you're on the WHMCS page (my.dominios.pt) and logged in.</div>
                </div>
            `;
        } else {
            // Actual WHMCS data
            whmcsContentHTML = whmcsData;
        }

        // --- Panel Content Structure with Tabs ---
        lookupPanel.innerHTML = `
            <div id="gm-panel-header" style="padding: 12px; background-color: #007acc; color: white; border-top-left-radius: 8px; border-top-right-radius: 8px; display: flex; justify-content: space-between; align-items: center;">
                <strong style="font-size: 16px;">Lookup: ${target.value}</strong>
                <button id="gm-close-btn" style="background: none; border: none; color: white; font-size: 18px; cursor: pointer; padding: 0 5px; line-height: 1;">&times;</button>
            </div>
            <div id="gm-tab-bar" style="display: flex; background-color: #2a2a2a; border-bottom: 1px solid #444;">
                <button id="gm-tab-dns" class="gm-tab gm-tab-active" style="background: none; border: none; border-bottom: 2px solid #007acc; color: #4dcfff; padding: 10px 20px; cursor: pointer; font-size: 14px; font-weight: bold; transition: all 0.2s;">DNS Info</button>
                <button id="gm-tab-whmcs" class="gm-tab gm-tab-inactive" style="background: none; border: none; border-bottom: 2px solid transparent; color: #aaa; padding: 10px 20px; cursor: pointer; font-size: 14px; transition: all 0.2s;">WHMCS</button>
            </div>
            <div id="gm-panel-body" style="padding: 15px; overflow-y: auto; flex-grow: 1;">
                <div id="gm-dns-content" style="display: block;">
                    ${generateContentHTML(dnsData)}
                </div>
                <div id="gm-whmcs-content" style="display: none;">
                    ${whmcsContentHTML}
                </div>
            </div>
        `;

        // Attach event handlers
        document.getElementById('gm-close-btn').addEventListener('click', hidePanel);
        document.getElementById('gm-tab-dns').addEventListener('click', () => switchTab('dns'));
        document.getElementById('gm-tab-whmcs').addEventListener('click', () => switchTab('whmcs'));

        // Add hover effects for tabs
        const tabs = document.querySelectorAll('.gm-tab');
        tabs.forEach(tab => {
            tab.addEventListener('mouseenter', function () {
                if (!this.classList.contains('gm-tab-active')) {
                    this.style.color = '#f4f4f4';
                }
            });
            tab.addEventListener('mouseleave', function () {
                if (!this.classList.contains('gm-tab-active')) {
                    this.style.color = '#aaa';
                }
            });
        });

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

    function switchTab(tabName) {
        activeTab = tabName;

        // Update tab button styles
        const dnsTab = document.getElementById('gm-tab-dns');
        const whmcsTab = document.getElementById('gm-tab-whmcs');
        const dnsContent = document.getElementById('gm-dns-content');
        const whmcsContent = document.getElementById('gm-whmcs-content');

        if (tabName === 'dns') {
            if (dnsTab) {
                dnsTab.classList.add('gm-tab-active');
                dnsTab.classList.remove('gm-tab-inactive');
            }
            if (whmcsTab) {
                whmcsTab.classList.remove('gm-tab-active');
                whmcsTab.classList.add('gm-tab-inactive');
            }
            if (dnsContent) dnsContent.style.display = 'block';
            if (whmcsContent) whmcsContent.style.display = 'none';
        } else if (tabName === 'whmcs') {
            if (dnsTab) {
                dnsTab.classList.remove('gm-tab-active');
                dnsTab.classList.add('gm-tab-inactive');
            }
            if (whmcsTab) {
                whmcsTab.classList.add('gm-tab-active');
                whmcsTab.classList.remove('gm-tab-inactive');
            }
            if (dnsContent) dnsContent.style.display = 'none';
            if (whmcsContent) whmcsContent.style.display = 'block';
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
                        <p style="margin: 3px 0;"><strong style="color: #ccc;">PTR Record:</strong> ${ipDetail.ptr || 'N/A'}</p>
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

    // --- WHMCS Result Rendering Functions ---
    function generateWHMCSContentHTML(data) {
        // Calculate total results
        const totalResults = (data.client?.length || 0) + (data.contact?.length || 0) +
            (data.service?.length || 0) + (data.domain?.length || 0) +
            (data.invoice?.length || 0) + (data.ticket?.length || 0) +
            (data.other?.length || 0);

        if (totalResults === 0) {
            return `
                <div style="text-align: center; padding: 40px; color: #aaa;">
                    <div style="font-size: 18px; margin-bottom: 10px;">No results found</div>
                    <div style="font-size: 14px;">Try a different search term</div>
                </div>
            `;
        }

        let html = `
            <div style="margin-bottom: 15px; padding: 10px; background-color: #444; border-radius: 4px;">
                <strong style="color: #4dcfff;">Total Results: ${totalResults}</strong>
            </div>
        `;

        if (data.client && data.client.length > 0) {
            html += generateWHMCSSection('Clients', data.client, 'client');
        }
        if (data.domain && data.domain.length > 0) {
            html += generateWHMCSSection('Domains', data.domain, 'domain');
        }
        if (data.service && data.service.length > 0) {
            html += generateWHMCSSection('Services', data.service, 'service');
        }
        if (data.contact && data.contact.length > 0) {
            html += generateWHMCSSection('Contacts', data.contact, 'contact');
        }
        if (data.invoice && data.invoice.length > 0) {
            html += generateWHMCSSection('Invoices', data.invoice, 'invoice');
        }
        if (data.ticket && data.ticket.length > 0) {
            html += generateWHMCSSection('Tickets', data.ticket, 'ticket');
        }
        if (data.other && data.other.length > 0) {
            html += generateWHMCSSection('Other', data.other, 'other');
        }

        return html;
    }

    function generateWHMCSSection(title, items, type) {
        let html = `
            <h4 style="margin: 15px 0 8px 0; color: #4dcfff; border-bottom: 1px solid #444; padding-bottom: 5px; font-size: 14px;">
                ${title} (${items.length})
            </h4>
        `;

        items.forEach(item => {
            html += generateWHMCSResultCard(item, type);
        });

        return html;
    }

    function generateWHMCSResultCard(item, type) {
        let cardContent = '';
        let statusBadge = '';
        let itemUrl = '';

        if (item.status) {
            const statusColor = getStatusColor(item.status);
            statusBadge = `<span style="background-color: ${statusColor}; padding: 3px 8px; border-radius: 4px; font-size: 11px; font-weight: bold; color: white;">${item.status.toUpperCase()}</span>`;
        }

        // Generate URL based on item type
        if (type === 'client' && item.id) {
            itemUrl = `${WHMCS_ROOT}clientssummary.php?userid=${item.id}`;
        }
        if (type == 'domain' && item.user_id && item.id) {
            itemUrl = `${WHMCS_ROOT}clientsdomains.php?userid=${item.user_id}&id=${item.id}`
        }
        if (type == 'service' && item.user_id && item.id) {
            itemUrl = `${WHMCS_ROOT}clientsservices.php?userid=${item.user_id}&productselect=${item.id}`
        }
        if (type == 'contact' && item.user_id && item.id) {
            itemUrl = `${WHMCS_ROOT}clientscontacts.php?userid=${item.user_id}&id=${item.id}`;
        }

        switch (type) {
            case 'client':
                cardContent = `
                    <div style="margin-bottom: 5px;">
                        <strong style="color: #fff;">${item.name || 'N/A'}</strong> ${statusBadge}
                    </div>
                    <div style="font-size: 12px; color: #ccc;">
                        ${item.company_name ? `<div>Company: ${item.company_name}</div>` : ''}
                        ${item.email ? `<div>Email: ${item.email}</div>` : ''}
                        ${item.id ? `<div>ID: ${item.id}</div>` : ''}
                        ${itemUrl ? `<div style="margin-top: 5px;"><a href="${itemUrl}" target="_blank" style="color: #4dcfff; text-decoration: none; font-size: 11px;" onmouseover="this.style.textDecoration='underline'" onmouseout="this.style.textDecoration='none'">Open in WHMCS \u2192</a></div>` : ''}
                    </div>
                `;
                break;

            case 'domain':
                cardContent = `
                    <div style="margin-bottom: 5px;">
                        <strong style="color: #fff;">${item.domain || 'N/A'}</strong> ${statusBadge}
                    </div>
                    <div style="font-size: 12px; color: #ccc;">
                        ${item.client_name ? `<div>Client: ${item.client_name}</div>` : ''}
                        ${item.client_company_name ? `<div>Company: ${item.client_company_name}</div>` : ''}
                        ${item.id ? `<div>ID: ${item.id}</div>` : ''}
                        ${itemUrl ? `<div style="margin-top: 5px;"><a href="${itemUrl}" target="_blank" style="color: #4dcfff; text-decoration: none; font-size: 11px;" onmouseover="this.style.textDecoration='underline'" onmouseout="this.style.textDecoration='none'">Open in WHMCS \u2192</a></div>` : ''}
                    </div>
                `;
                break;

            case 'service':
                cardContent = `
                    <div style="margin-bottom: 5px;">
                        <strong style="color: #fff;">${item.product_name || 'N/A'}</strong> ${statusBadge}
                    </div>
                    <div style="font-size: 12px; color: #ccc;">
                        ${item.domain ? `<div>Domain: ${item.domain}</div>` : ''}
                        ${item.client_name ? `<div>Client: ${item.client_name}</div>` : ''}
                        ${item.client_company_name ? `<div>Company: ${item.client_company_name}</div>` : ''}
                        ${item.id ? `<div>ID: ${item.id}</div>` : ''}
                        ${itemUrl ? `<div style="margin-top: 5px;"><a href="${itemUrl}" target="_blank" style="color: #4dcfff; text-decoration: none; font-size: 11px;" onmouseover="this.style.textDecoration='underline'" onmouseout="this.style.textDecoration='none'">Open in WHMCS \u2192</a></div>` : ''}
                    </div>
                `;
                break;

            default:
                cardContent = `<pre style="font-size: 11px; color: #ccc;">${JSON.stringify(item, null, 2)}</pre>`;
                if (itemUrl) {
                    cardContent += `<div style="margin-top: 5px;"><a href="${itemUrl}" target="_blank" style="color: #4dcfff; text-decoration: none; font-size: 11px;" onmouseover="this.style.textDecoration='underline'" onmouseout="this.style.textDecoration='none'">Open in WHMCS \u2192</a></div>`;
                }
        }

        return `
            <div style="border-left: 3px solid #007acc; padding: 10px; margin-bottom: 10px; background-color: #3a3a3a; border-radius: 4px; cursor: pointer; transition: background-color 0.2s;"
                 onmouseover="this.style.backgroundColor='#404040'"
                 onmouseout="this.style.backgroundColor='#3a3a3a'">
                ${cardContent}
            </div>
        `;
    }

    function getStatusColor(status) {
        const statusLower = status.toLowerCase();
        if (statusLower.includes('active')) return '#28a745';
        if (statusLower.includes('inactive')) return '#6c757d';
        if (statusLower.includes('suspended')) return '#dc3545';
        if (statusLower.includes('pending')) return '#ffc107';
        if (statusLower.includes('cancelled')) return '#dc3545';
        if (statusLower.includes('expired')) return '#dc3545';
        return '#007acc';
    }

    function generateWHMCSErrorHTML(message) {
        return `
            <div style="text-align: center; padding: 40px; color: #e74c3c;">
                <div style="font-size: 18px; margin-bottom: 10px;">Error</div>
                <div style="font-size: 14px;">${message}</div>
            </div>
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
        }, null);

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
                    showPanel(target, errorData, null);
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

                    // Don't call showPanel here - WHMCS fetch will update the panel
                    // Just update the DNS content
                    const dnsContent = document.getElementById('gm-dns-content');
                    if (dnsContent) {
                        dnsContent.innerHTML = generateContentHTML(parsedData);
                    }

                } catch (e) {
                    console.error('Error parsing API response. Error:', e);
                    // Removed ip_subnet from error data construction
                    const errorData = { isDomain: target.type === 'domain', a_records: target.type === 'domain' ? ['Parsing Error'] : [], ip_geo_details: [], ip_provider: 'Returned Non-JSON', ip_location: 'Check console for raw response text.', ns: [], mx: [], cname: [], spf: [], ip_address: 'N/A' };
                    const dnsContent = document.getElementById('gm-dns-content');
                    if (dnsContent) {
                        dnsContent.innerHTML = generateContentHTML(errorData);
                    }
                }
            },
            onerror: function (response) {
                console.error("[Domain Lookup] GM_xmlHttpRequest FAILED. Status:", response.status, "Details:", response);
                // Removed ip_subnet from error data construction
                const errorData = { isDomain: target.type === 'domain', a_records: target.type === 'domain' ? ['GM_XHR Failed'] : [], ip_geo_details: [], ip_provider: 'Network/Security Error', ip_location: `Status: ${response.status}. See console.`, ns: [], mx: [], cname: [], spf: [], ip_address: 'N/A' };
                const dnsContent = document.getElementById('gm-dns-content');
                if (dnsContent) {
                    dnsContent.innerHTML = generateContentHTML(errorData);
                }
            },
            ontimeout: function () {
                console.error("[Domain Lookup] GM_xmlHttpRequest TIMEOUT FIRED.");
                // Removed ip_subnet from error data construction
                const errorData = { isDomain: target.type === 'domain', a_records: target.type === 'domain' ? ['Timeout (10s)'] : [], ip_geo_details: [], ip_provider: 'Request Timed Out', ip_location: 'Server took too long to respond.', ns: [], mx: [], cname: [], spf: [], ip_address: 'N/A' };
                const dnsContent = document.getElementById('gm-dns-content');
                if (dnsContent) {
                    dnsContent.innerHTML = generateContentHTML(errorData);
                }
            }
        });
    }

    function fetchWHMCSInfo(searchTerm, token) {
        // Update WHMCS tab with loading state (already set in showPanel initial call)

        // Prepare POST data
        const formData = new URLSearchParams();
        formData.append('token', token);
        formData.append('searchterm', searchTerm);
        formData.append('hide_inactive', '0');
        formData.append('more', '');

        GM_XHR({
            method: 'POST',
            url: WHMCS_API_URL,
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            data: formData.toString(),
            timeout: 60000,
            onload: function (response) {
                try {
                    const data = JSON.parse(response.responseText);
                    const whmcsHtml = generateWHMCSContentHTML(data);
                    const whmcsContent = document.getElementById('gm-whmcs-content');
                    if (whmcsContent) {
                        whmcsContent.innerHTML = whmcsHtml;
                    }
                } catch (e) {
                    console.error('[WHMCS] Error parsing response:', e);
                    console.log(WHMCS_API_URL)
                    console.log(response.responseText)
                    const whmcsContent = document.getElementById('gm-whmcs-content');
                    if (whmcsContent) {
                        whmcsContent.innerHTML = generateWHMCSErrorHTML('Failed to parse response');
                    }
                }
            },
            onerror: function (response) {
                console.error('[WHMCS] Request failed:', response);
                const whmcsContent = document.getElementById('gm-whmcs-content');
                if (whmcsContent) {
                    whmcsContent.innerHTML = generateWHMCSErrorHTML('Network error. Please try again.');
                }
            },
            ontimeout: function () {
                console.error('[WHMCS] Request timed out');
                const whmcsContent = document.getElementById('gm-whmcs-content');
                if (whmcsContent) {
                    whmcsContent.innerHTML = generateWHMCSErrorHTML('Request timed out (10s)');
                }
            }
        });
    }

    // --- Main Event Listener ---
    let isPanelActive = false;

    document.addEventListener('mouseup', function (event) {
        // Don't process mouseup events from inside the panel
        if (lookupPanel && lookupPanel.contains(event.target)) {
            return;
        }

        const selection = window.getSelection();
        if (selection.rangeCount > 0) {
            // Check if the selection originated from within our panel
            const selectionContainer = selection.anchorNode;
            let isSelectionFromPanel = false;

            // Check if the selection is inside our panel
            if (lookupPanel && lookupPanel.contains(selectionContainer)) {
                isSelectionFromPanel = true;
            }

            // Only process selections that are NOT from our panel
            if (!isSelectionFromPanel) {
                // Trim and sanitize the selected text
                const selectedText = selection.toString().trim();
                const target = isValidTarget(selectedText);

                // Check if the selected text is a valid target
                if (target) {
                    // Prevent the panel from closing immediately if a valid selection is made
                    event.stopPropagation();
                    isPanelActive = true;

                    // Fetch DNS info (will show panel with loading states)
                    fetchDNSInfo(target);

                    // Fetch fresh WHMCS token in background and perform search
                    fetchFreshWHMCSToken(function (token) {
                        if (token) {
                            console.log('[WHMCS] Fresh token obtained, initiating search...');
                            fetchWHMCSInfo(target.value, token);
                        } else {
                            console.warn('[WHMCS] Failed to fetch fresh token.');
                            // Update WHMCS tab to show error
                            setTimeout(() => {
                                const whmcsContent = document.getElementById('gm-whmcs-content');
                                if (whmcsContent) {
                                    whmcsContent.innerHTML = generateWHMCSErrorHTML('Failed to fetch WHMCS token. Please check your connection and ensure you can access my.dominios.pt.');
                                }
                            }, 100); // Small delay to ensure panel is created
                        }
                    });
                }
            }
            // Don't hide panel when selection changes - let user keep it open
        }
    });

    // Handle clicks outside the panel to close it
    document.addEventListener('mousedown', function (event) {
        if (!lookupPanel) return;

        // Check if clicked inside the panel
        if (lookupPanel.contains(event.target)) {
            // Clicked inside the panel, do nothing to allow scrolling and interaction
            return;
        }

        // Only hide if clicking outside the panel AND the panel is active
        if (lookupPanel.style.opacity === '1' && isPanelActive) {
            hidePanel();
            isPanelActive = false;
        }
    });

    // Initialize the panel element
    createPanel();
})();
