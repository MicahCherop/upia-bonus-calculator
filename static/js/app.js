(() => {
    "use strict";

    const formatKES = (num) => new Intl.NumberFormat('en-KE', { style: 'currency', currency: 'KES', maximumFractionDigits: 0 }).format(num);

    const TARGETS = { disbursement: 98.0, active_customers: 95.0, new_customers: 95.0, otc: 91.5, dd7: 94.0, new_customer_otc: 90.0 };

    const toTitleCase = (str) => {
        if (!str) return "";
        return str.replace(/\w\S*/g, (txt) => txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase());
    };

    const decodeJwt = (token) => {
        try {
            const base64Url = token.split('.')[1];
            const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
            return JSON.parse(window.atob(base64));
        } catch (e) {
            return {};
        }
    };

  window.handleGoogleLogin = async (response) => {
    const authStatus = document.getElementById('auth-status-text');
    const loginError = document.getElementById('login-error');
    if (loginError) loginError.style.display = 'none';

    if (authStatus) {
        authStatus.innerHTML = `<span style="color: var(--text-muted); font-weight: 500;">Authenticating securely... Please wait.</span>`;
        authStatus.style.display = 'block';
    }

    try {
        const res = await fetch('/api/auth/google', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ credential: response.credential })
        });
        const data = await res.json();

        if (data.success) {
            const googlePayload = decodeJwt(response.credential);
            const finalUser = data.user;
            if (googlePayload.picture) {
                finalUser.picture = googlePayload.picture;
            }

            sessionStorage.setItem('upia_google_token', response.credential);
            sessionStorage.setItem('upia_user', JSON.stringify(finalUser)); 
            
            // Pre-cache Ops Payload for instant dashboard loading
            if (finalUser.is_ops) {
                if (data.all_staff) sessionStorage.setItem('upia_ops_staff', JSON.stringify(data.all_staff));
                if (data.raw_performance) sessionStorage.setItem('upia_ops_perf', JSON.stringify(data.raw_performance));
            }
            
            if (authStatus) {
                authStatus.innerHTML = `<span style="color: #10b981; font-weight: 600;">✓ Access granted. Redirecting...</span>`;
            }
            
            window.location.href = '/overview';
        } else {
            throw new Error(data.error || "Unauthorized access.");
        }
    } catch (err) {
        if (authStatus) authStatus.style.display = 'none';
        if (loginError) {
            loginError.textContent = err.message || "Authentication failed.";
            loginError.style.display = 'block';
        }
    }
};

window.renderGoogleButton = function() {
    const container = document.getElementById('g_id_signin_container');
    if (!container || typeof google === 'undefined' || !google.accounts) return;

    const currentTheme = document.documentElement.getAttribute('data-theme') || 'light';
    container.innerHTML = '';

    // Initialize programmatically without auto-prompt popups
    google.accounts.id.initialize({
        client_id: "85732911341-tfjnf14n13laa692di7ntici1d17b3pe.apps.googleusercontent.com",
        callback: window.handleGoogleLogin,
        auto_select: false,
        itp_support: true
    });

    google.accounts.id.renderButton(container, { 
        type: "standard", 
        shape: "rectangular", 
        theme: currentTheme === 'dark' ? "filled_black" : "outline", 
        text: "signin_with", 
        size: "large", 
        logo_alignment: "left" 
    });
};
    const appWrapper = document.getElementById('app-wrapper');
    if (appWrapper) {
        let loggedInUser = null;
        let viewedUser = null; 
        let currentUser = null;
        
        let allStaffData = [];
        let rawPerformance = {};
        
        let isImpersonating = false;
        let filteredStaff = [];
        let currentPage = 1;
        let pageSize = 25;

        const setElText = (id, text) => {
            const el = document.getElementById(id);
            if (el) el.textContent = text;
        };

        const formatRange = (min, max) => {
            if (max === null || max === undefined || max === Infinity) return `${min}+`;
            if (min === 0) return `< ${max}`;
            return `${min} - ${max}`;
        };

        const handleNavigation = (targetView) => {
            if (!targetView) return;
            const activePanel = document.getElementById(`view-${targetView}`);
            
            if (!activePanel) return; 

            document.querySelectorAll('.view-panel').forEach(panel => panel.style.display = 'none');
            document.querySelectorAll('.menu-item').forEach(item => item.classList.remove('active'));

            activePanel.style.display = 'block';

            const sidebarItem = document.querySelector(`.menu-item[data-view="${targetView}"]`);
            if (sidebarItem) sidebarItem.classList.add('active');

            const mainWorkspace = document.querySelector('.main-workspace');
            if (mainWorkspace) {
                if (targetView === 'ops') {
                    mainWorkspace.classList.add('full-width');
                    mainWorkspace.style.maxWidth = '100%';
                } else {
                    mainWorkspace.classList.remove('full-width');
                    mainWorkspace.style.maxWidth = '1100px';
                }
            }
        };

        const getTransferMonthCode = (dateStr) => {
            if (!dateStr) return "100000"; 
            let str = String(dateStr).trim();

            const parts = str.split(/[-/]/);
            if (parts.length >= 3) {
                const day = parseInt(parts[0], 10);
                const month = parseInt(parts[1], 10);
                const year = parseInt(parts[2], 10);
                
                if (year > 2000 && month >= 1 && month <= 12) {
                    return `${year}${String(month).padStart(2, '0')}`;
                } else if (day > 2000 && month >= 1 && month <= 12) {
                    return `${day}${String(month).padStart(2, '0')}`;
                }
            }

            if (/^[a-zA-Z]+$/.test(str)) str += ` ${new Date().getFullYear()}`;
            const d = new Date(str);
            if (isNaN(d)) return "100000";
            return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}`;
        };

        const getActiveProfile = (user, monthCode) => {
            // OPTIMIZATION: Return instantly if already calculated
            if (!user._profileCache) user._profileCache = {};
            if (user._profileCache[monthCode]) return user._profileCache[monthCode];

            const evaluate = () => {
                const transferDate = user.date_exited || user.date_reported; 
                const transferMonthCode = getTransferMonthCode(transferDate);
                const hasPreviousBranch = user.previous_branch && String(user.previous_branch).trim() !== "";

                if (hasPreviousBranch && monthCode <= transferMonthCode) {
                    return {
                        branch: toTitleCase(String(user.previous_branch).trim()), 
                        type: String(user.previous_role || user.type).trim(), 
                        pairs: String(user.previous_pairs || user.pairs || "1").trim(), 
                        isHistorical: true
                    };
                }
                
                return {
                    branch: toTitleCase(String(user.branch || "").trim()),
                    type: String(user.type || "").trim(),
                    pairs: String(user.pairs || "1").trim(),
                    isHistorical: false
                };
            };

            const result = evaluate();
            user._profileCache[monthCode] = result; // Save to cache
            return result;
        };

        const checkLateReporting = (user, monthCode) => {
            // OPTIMIZATION: Stop re-parsing dates on every render
            if (!user._lateCache) user._lateCache = {};
            if (user._lateCache[monthCode] !== undefined) return user._lateCache[monthCode];

            const evaluate = () => {
                const isTransfer = user.previous_branch && String(user.previous_branch).trim() !== "";
                if (isTransfer) return false; 
                
                if (!user.date_reported) return true; 

                let str = String(user.date_reported).trim().split(' ')[0];
                if (str === "" || str.toLowerCase().includes("n/a") || str.toLowerCase() === "none" || str.toLowerCase() === "not reported") return true; 

                const parts = str.split(/[-/]/);
                if (parts.length >= 3) {
                    let day, month, year;
                    if (parts[0].length === 4) { 
                        year = parseInt(parts[0], 10); month = parseInt(parts[1], 10); day = parseInt(parts[2], 10);
                    } else { 
                        day = parseInt(parts[0], 10); month = parseInt(parts[1], 10); year = parseInt(parts[2], 10);
                    }
                    const reportMonthCode = `${year}${String(month).padStart(2, '0')}`;
                    if (monthCode === reportMonthCode && day > 5) return true;
                    if (monthCode < reportMonthCode) return true;
                } else {
                    const d = new Date(str);
                    if (!isNaN(d.getTime())) {
                        const day = d.getDate();
                        const reportMonthCode = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}`;
                        if (monthCode === reportMonthCode && day > 5) return true;
                        if (monthCode < reportMonthCode) return true;
                    }
                }
                return false;
            };

            const result = evaluate();
            user._lateCache[monthCode] = result; // Save to cache
            return result;
        };


        // 🚀 SPEED FIX: Global dictionary to prevent millions of loop iterations
        let _perfIndexCache = null;

        const computePerformanceForUser = (user, perfData) => {
            if (!user || !perfData) return;
            user.performance = {};

            // 1. Build the fast-lookup dictionary EXACTLY ONCE for the whole app
            if (!_perfIndexCache) {
                _perfIndexCache = {};
                Object.entries(perfData).forEach(([key, metrics]) => {
                    const parts = key.split('_');
                    const mCode = parts.pop(); // The last item is the month
                    const prefix = parts.join('_').toLowerCase(); 
                    if (!_perfIndexCache[mCode]) _perfIndexCache[mCode] = {};
                    _perfIndexCache[mCode][prefix] = metrics;
                });
            }

            // 2. Lookup data instantly in O(1) time
            Object.keys(_perfIndexCache).forEach(monthCode => {
                const profile = getActiveProfile(user, monthCode);
                const targetBranch = (profile.branch || '').toLowerCase().trim();
                const targetType = (profile.type || '').toUpperCase();
                const isBM = targetType.includes('BM') || targetType.includes('MANAGER');

                let lookupKey = '';
                if (isBM) {
                    lookupKey = targetBranch;
                } else {
                    let rawPair = String(profile.pairs).toLowerCase().trim();
                    if (rawPair === '1' || rawPair === '') rawPair = 'pair 1';
                    else if (rawPair === '2') rawPair = 'pair 2';
                    else if (rawPair === '3') rawPair = 'pair 3';
                    lookupKey = `${targetBranch}_${rawPair}`;
                }

                // If a match exists in the dictionary, assign it instantly!
                if (_perfIndexCache[monthCode][lookupKey]) {
                    user.performance[monthCode] = _perfIndexCache[monthCode][lookupKey];
                }
            });
        };

        const cachedUserStr = sessionStorage.getItem('upia_user');
        if (cachedUserStr) {
            try {
                const cUser = JSON.parse(cachedUserStr);
                if (cUser.is_ops) {
                    const dashNav = document.getElementById('main-nav-item');
                    if (dashNav) {
                        dashNav.setAttribute('data-view', 'ops');
                        dashNav.querySelector('.menu-text').textContent = 'Overview';
                    }
                    handleNavigation('ops');
                } else {
                    handleNavigation('dashboard');
                }
            } catch(e) {
                console.warn("Pre-loader error:", e);
            }
        }

        const renderOpsStaffTable = () => {
            const tbody = document.getElementById('ops-staff-tbody');
            if (!tbody) return;
            tbody.innerHTML = '';

            const totalItems = filteredStaff.length;
            const totalPages = Math.ceil(totalItems / pageSize) || 1;
            if (currentPage > totalPages) currentPage = totalPages;

            const startIndex = (currentPage - 1) * pageSize;
            const endIndex = Math.min(startIndex + pageSize, totalItems);
            const pageData = filteredStaff.slice(startIndex, endIndex);

            pageData.forEach(staff => {
                const tr = document.createElement('tr');
                
                // Row click & hover logic
                tr.style.cursor = 'pointer';
                tr.onmouseover = () => tr.style.backgroundColor = 'rgba(16, 185, 129, 0.1)'; 
                tr.onmouseout = () => tr.style.backgroundColor = '';
                tr.onclick = () => impersonateStaff(staff.email);
                
                // Inject the 5 columns (Notice there is no button HTML here)
                tr.innerHTML = `
                    <td style="font-weight: 600;">${staff.name}</td>
                    <td>${staff.email}</td>
                    <td>${staff.branch || '-'}</td>
                    <td>${staff.type || '-'}</td>
                    <td>${staff.id || '-'}</td>
                `;
                tbody.appendChild(tr);
            });
            const pageInfo = document.getElementById('ops-page-info');
            if (pageInfo) pageInfo.textContent = `Page ${currentPage} of ${totalPages} (${totalItems} items)`;
        };

       const renderOpsAnalytics = (perfData) => {
            const ctxBonus = document.getElementById('opsBonusChart');
            const ctxBand = document.getElementById('opsBandChart');
            if (!ctxBonus || !ctxBand || typeof Chart === 'undefined' || !perfData) return;

            allStaffData.forEach(staff => {
                if (!staff.performance) computePerformanceForUser(staff, perfData);
            });

            // 1. DATE FILTER (Force start from January)
            const today = new Date();
            const currentYear = today.getFullYear();
            const maxDate = new Date(currentYear, today.getMonth() - 2, 1);
            const maxMonthCode = `${maxDate.getFullYear()}${String(maxDate.getMonth() + 1).padStart(2, '0')}`;
            const minMonthCode = `${currentYear}01`; 

            const monthSet = new Set();
            if (maxDate.getFullYear() === currentYear) {
                for (let m = 1; m <= maxDate.getMonth() + 1; m++) {
                    monthSet.add(`${currentYear}${String(m).padStart(2, '0')}`);
                }
            }

            allStaffData.forEach(staff => {
                if (staff.performance) {
                    Object.keys(staff.performance).forEach(m => {
                        if (m >= minMonthCode && m <= maxMonthCode) monthSet.add(m);
                    });
                }
            });
            const sortedMonths = Array.from(monthSet).sort();

            const checkEligibility = (p, mCode) => {
                const getRate = (a, t, rate) => (t > 0 && !isNaN(a) && !isNaN(t)) ? ((a / t) * 100) : (rate ? (parseFloat(String(rate).replace('%','')) <= 1 ? (parseFloat(rate)*100) : parseFloat(rate)) : 0.0);
                const parseRate = (v) => (!v) ? 0.0 : (parseFloat(String(v).replace('%','')) <= 1 ? (parseFloat(v)*100) : parseFloat(v));

                const disb = getRate(p.disb_actual, p.disb_target, p.disb_rate);
                const ac = getRate(p.ac_actual, p.ac_target, p.ac_rate);
                const nc = getRate(p.nc_actual, p.nc_target, p.nc_rate);
                const otc = parseRate(p.overall_otc);
                const dd7 = parseRate(p.dd7_rate);
                const nc_otc = parseRate(p.new_customer_otc);

                const round2 = (num) => Math.round((num + Number.EPSILON) * 100) / 100;

                let passes_nc_otc = round2(nc_otc) >= 90.00;
                
                if (mCode <= '202607') passes_nc_otc = true;

                const passes_collections = round2(otc) >= 91.50 && round2(dd7) >= 94.00 && passes_nc_otc;
                const passes_sales = round2(disb) >= 98.00 && round2(ac) >= 95.00 && round2(nc) >= 95.00;

                return {
                    full: passes_sales && passes_collections,
                    partial: passes_collections && !passes_sales
                };
            };

            const labels = [];
            const fullData = [];
            const partialData = [];
            const missedData = []; 
            
            const eliteBandData = [];
            const growthBandData = [];
            const baselineBandData = [];
            const floorBandData = [];

            let latestStaffCategorization = { full: [], partial: [], missed: [] };
            const latestMonthCodeToQuery = sortedMonths.length > 0 ? sortedMonths[sortedMonths.length - 1] : null;

            const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

            sortedMonths.forEach(mCode => {
                const year = mCode.substring(0, 4);
                const monthIdx = parseInt(mCode.substring(4, 6), 10) - 1;
                labels.push(`${monthNames[monthIdx] || ''} ${year}`);

                let fCount = 0, pCount = 0, mCount = 0;
                let eCount = 0, gCount = 0, bCount = 0, flCount = 0;

                allStaffData.forEach(staff => {
                    const activeProfile = getActiveProfile(staff, mCode);
                    
                    // 2. EXCLUDE NON-REPORTING STAFF
                    if (!activeProfile.isHistorical && checkLateReporting(staff, mCode)) {
                        return; 
                    }

                    const p = staff.performance ? staff.performance[mCode] : null;
                    if (p) {
                        const elig = checkEligibility(p, mCode);
                        const cust = parseInt(p.ac_actual) || 0;

                        if (elig.full) fCount++;
                        else if (elig.partial) pCount++;
                        else mCount++;

                        if (elig.full || elig.partial) {
                            if (cust > 500) eCount++;
                            else if (cust > 350) gCount++;
                            else if (cust > 200) bCount++;
                            else flCount++;
                        }

                        if (mCode === latestMonthCodeToQuery) {
                            const staffObj = { ...staff, customers: cust };
                            if (elig.full) latestStaffCategorization.full.push(staffObj);
                            else if (elig.partial) latestStaffCategorization.partial.push(staffObj);
                            else latestStaffCategorization.missed.push(staffObj);
                        }
                    } else if (mCode === latestMonthCodeToQuery) {
                        mCount++;
                        latestStaffCategorization.missed.push({ ...staff, customers: 0 });
                    }
                });

                fullData.push(fCount);
                partialData.push(pCount);
                missedData.push(mCount);

                eliteBandData.push(eCount);
                growthBandData.push(gCount);
                baselineBandData.push(bCount);
                floorBandData.push(flCount);
            });

            if (sortedMonths.length > 0) {
                const latestIdx = sortedMonths.length - 1;
                if (document.getElementById('kpi-full-bonus')) document.getElementById('kpi-full-bonus').textContent = fullData[latestIdx];
                if (document.getElementById('kpi-partial-bonus')) document.getElementById('kpi-partial-bonus').textContent = partialData[latestIdx];
                if (document.getElementById('kpi-missed-bonus')) document.getElementById('kpi-missed-bonus').textContent = missedData[latestIdx];
                
                document.querySelectorAll('.kpi-month-label').forEach(el => {
                    el.textContent = `(${labels[latestIdx]})`;
                });
            }

            const kpiCardsConfig = {
                'kpi-card-full': { title: 'Staff: Full Bonus Qualified', data: latestStaffCategorization.full },
                'kpi-card-partial': { title: 'Staff: 45% Collection Bonus', data: latestStaffCategorization.partial },
                'kpi-card-missed': { title: 'Staff: Did Not Qualify', data: latestStaffCategorization.missed }
            };

            // 3. BULLETPROOF renderKpiTable
            async function renderKpiTable(title, data) {
                const titleEl = document.getElementById('kpi-staff-list-title');
                if (!titleEl) return;
                
                titleEl.textContent = title;

                if (titleEl.parentElement) {
                    titleEl.parentElement.style.position = 'relative';
                    titleEl.parentElement.style.display = 'flex';
                    titleEl.parentElement.style.alignItems = 'center';
                }

                let oldMenu = document.getElementById('export-menu-container');
                if (oldMenu) oldMenu.remove(); 

                const exportMenu = document.createElement('div');
                exportMenu.id = 'export-menu-container';
                exportMenu.style.cssText = 'position: absolute; right: 0; top: 50%; transform: translateY(-50%);';

                const btnTrigger = document.createElement('button');
                btnTrigger.style.cssText = 'background: transparent; border: none; cursor: pointer; padding: 4px; color: inherit; display: flex; align-items: center; justify-content: center;';
                btnTrigger.innerHTML = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="2"></circle><circle cx="12" cy="5" r="2"></circle><circle cx="12" cy="19" r="2"></circle></svg>`;

                const dropdownBox = document.createElement('div');
                dropdownBox.style.cssText = 'display: none; position: absolute; right: 0; top: 100%; margin-top: 5px; background: var(--card-bg, #ffffff); border: 1px solid var(--border-color, #e2e8f0); border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.15); z-index: 1000; min-width: 220px; overflow: hidden; color: inherit;';

                const btnCsv = document.createElement('div');
                btnCsv.style.cssText = 'padding: 12px 16px; cursor: pointer; font-size: 13px; font-weight: 500; border-bottom: 1px solid var(--border-color, #e2e8f0); display: flex; align-items: center; gap: 8px; color: inherit;';
                btnCsv.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg> Download as CSV File`;

                const btnSheets = document.createElement('div');
                btnSheets.style.cssText = 'padding: 12px 16px; cursor: pointer; font-size: 13px; font-weight: 500; display: flex; align-items: center; gap: 8px; color: inherit;';
                btnSheets.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="8" y1="13" x2="16" y2="13"></line><line x1="8" y1="17" x2="16" y2="17"></line><line x1="12" y1="13" x2="12" y2="17"></line></svg> Copy for Google Sheets`;

                dropdownBox.appendChild(btnCsv);
                dropdownBox.appendChild(btnSheets);
                exportMenu.appendChild(btnTrigger);
                exportMenu.appendChild(dropdownBox);
                titleEl.insertAdjacentElement('afterend', exportMenu);

                btnTrigger.onclick = (e) => {
                    e.stopPropagation();
                    dropdownBox.style.display = dropdownBox.style.display === 'none' ? 'block' : 'none';
                };
                
                document.addEventListener('click', (e) => {
                    if (!exportMenu.contains(e.target)) dropdownBox.style.display = 'none';
                });

                const tbody = document.getElementById('kpi-staff-tbody');
                document.getElementById('kpi-staff-list-container').style.display = 'block';
                
                tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; padding: 20px; color: var(--text-muted);">Calculating exact payouts... Please wait.</td></tr>';

                const theadTr = tbody.parentElement.querySelector('thead tr');
                if (theadTr) {
                    const headers = theadTr.querySelectorAll('th');
                    if (headers.length >= 4) headers[3].textContent = 'Staff ID';

                    // DESTROY THE ACTION HEADER
                    const lastHeader = headers[headers.length - 1];
                    if (lastHeader && (lastHeader.textContent.includes('Action') || lastHeader.textContent.includes('View'))) {
                        lastHeader.remove();
                    }

                    if (!document.getElementById('th-payout')) {
                        const th = document.createElement('th');
                        th.id = 'th-payout';
                        th.textContent = 'Total Payout';
                        theadTr.appendChild(th); 
                    }
                }

                const payloads = data.map(staff => {
                    const activeProfile = getActiveProfile(staff, latestMonthCodeToQuery);
                    let fixedSalary = 29108; 
                    const roleUpper = (activeProfile.type || '').toUpperCase();
                    const pairsStr = String(activeProfile.pairs || '');

                    if (roleUpper.includes('BM') || roleUpper.includes('MANAGER')) {
                        if (pairsStr.includes('3')) fixedSalary = 77000;
                        else if (pairsStr.includes('2')) fixedSalary = 67507;
                        else fixedSalary = 45397; 
                    }

                    let safeDateReported = staff.date_reported || "";
                    if (activeProfile.isHistorical) safeDateReported = "01-01-2000"; 

                    const p = staff.performance ? staff.performance[latestMonthCodeToQuery] : null;
                    const getRate = (a, t, rate) => (t > 0 && !isNaN(a) && !isNaN(t)) ? ((a / t) * 100) : (rate ? (parseFloat(String(rate).replace('%','')) <= 1 ? (parseFloat(rate)*100) : parseFloat(rate)) : 0.0);
                    const parseRate = (v) => (!v) ? 0.0 : (parseFloat(String(v).replace('%','')) <= 1 ? (parseFloat(v)*100) : parseFloat(v));

                    let disbVal = 0, acVal = 0, ncVal = 0, otcVal = 0, dd7Val = 0, ncOtcVal = 0, disbAct = 0, custCount = 0;
                    if (p) {
                        disbVal = getRate(p.disb_actual, p.disb_target, p.disb_rate) / 100;
                        acVal = getRate(p.ac_actual, p.ac_target, p.ac_rate) / 100;
                        ncVal = getRate(p.nc_actual, p.nc_target, p.nc_rate) / 100;
                        otcVal = parseRate(p.overall_otc) / 100;
                        dd7Val = parseRate(p.dd7_rate) / 100;
                        ncOtcVal = parseRate(p.new_customer_otc) / 100;
                        disbAct = parseFloat(p.disb_actual) || 0;
                        custCount = parseInt(p.ac_actual) || 0;
                    }

                    return {
                        email: staff.email, employee_name: staff.name, employee_id: staff.id, 
                        employee_type: activeProfile.type, pairs: activeProfile.pairs, salary: fixedSalary, 
                        customers: custCount, disb_actual: disbAct, disbursement: disbVal, 
                        active_customers: acVal, new_customers: ncVal, otc: otcVal, dd7: dd7Val, 
                        new_customer_otc: ncOtcVal, date_reported: safeDateReported, month: latestMonthCodeToQuery
                    };
                });

                let payoutsMap = {};
                try {
                    const res = await fetch('/api/calculate/bulk', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ payloads })
                    });
                    const bulkData = await res.json();
                    if (bulkData.success) payoutsMap = bulkData.payouts;
                } catch (e) {
                    console.error("Bulk calc failed", e);
                }
                
                tbody.innerHTML = '';
                const sortedData = data.sort((a, b) => a.name.localeCompare(b.name));

                sortedData.forEach(staff => {
                    const tr = document.createElement('tr');
                    const activeProfile = getActiveProfile(staff, latestMonthCodeToQuery);
                    const displayBranch = activeProfile.isHistorical ? `${activeProfile.branch} (Prev)` : activeProfile.branch;
                    const payoutVal = payoutsMap[staff.email] || 0;

                    // DIRECT ROW CLICKS!
                    tr.style.cursor = 'pointer';
                    tr.onmouseover = () => tr.style.backgroundColor = 'rgba(16, 185, 129, 0.1)'; 
                    tr.onmouseout = () => tr.style.backgroundColor = '';
                    tr.onclick = () => impersonateStaff(staff.email);

                    // NO MORE VIEW BUTTON. Exactly 5 columns.
                    tr.innerHTML = `
                        <td style="font-weight: 600;">${staff.name}</td>
                        <td>${displayBranch || '-'}</td>
                        <td>${staff.type || '-'}</td>
                        <td>${staff.id || '-'}</td>
                        <td style="font-weight: 700; color: #10b981;">${formatKES(payoutVal)}</td>
                    `;
                    tbody.appendChild(tr);
                });

                const getExportName = () => {
                    const monthLabelEl = document.querySelector('.kpi-month-label');
                    const shortMonth = monthLabelEl ? monthLabelEl.textContent.replace(/[()]/g, '').split(' ')[0] : 'Current';
                    const fullMonths = { "Jan": "January", "Feb": "February", "Mar": "March", "Apr": "April", "May": "May", "Jun": "June", "Jul": "July", "Aug": "August", "Sep": "September", "Oct": "October", "Nov": "November", "Dec": "December" };
                    const safeTitle = title.replace('Staff: ', '');
                    return `${fullMonths[shortMonth] || shortMonth} ${safeTitle} List`;
                };

                btnCsv.onclick = () => {
                    dropdownBox.style.display = 'none';
                    let csvContent = "Name,Branch,Role,Staff ID,Total Payout (KES)\n";
                    sortedData.forEach(staff => {
                        const activeProfile = getActiveProfile(staff, latestMonthCodeToQuery);
                        const displayBranch = activeProfile.isHistorical ? `${activeProfile.branch} (Prev)` : activeProfile.branch;
                        const payout = payoutsMap[staff.email] || 0;
                        csvContent += `"${staff.name}","${displayBranch}","${staff.type}","${staff.id || ''}","${payout}"\n`;
                    });

                    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
                    const link = document.createElement("a");
                    link.href = URL.createObjectURL(blob);
                    link.download = `${getExportName()}.csv`;
                    document.body.appendChild(link);
                    link.click();
                    document.body.removeChild(link);
                };

                btnSheets.onclick = async () => {
                    dropdownBox.style.display = 'none';
                    let tsvContent = "Name\tBranch\tRole\tStaff ID\tTotal Payout (KES)\n";
                    sortedData.forEach(staff => {
                        const activeProfile = getActiveProfile(staff, latestMonthCodeToQuery);
                        const displayBranch = activeProfile.isHistorical ? `${activeProfile.branch} (Prev)` : activeProfile.branch;
                        const payout = payoutsMap[staff.email] || 0;
                        tsvContent += `${staff.name}\t${displayBranch}\t${staff.type}\t${staff.id || ''}\t${payout}\n`;
                    });
                    
                    const origHTML = btnSheets.innerHTML;

                    try {
                        if (navigator.clipboard && window.isSecureContext) {
                            await navigator.clipboard.writeText(tsvContent);
                        } else {
                            const textArea = document.createElement("textarea");
                            textArea.value = tsvContent;
                            textArea.style.position = "fixed";
                            textArea.style.left = "-9999px";
                            document.body.appendChild(textArea);
                            textArea.focus();
                            textArea.select();
                            document.execCommand('copy');
                            document.body.removeChild(textArea);
                        }

                        btnSheets.innerHTML = '<span style="color:#10b981; font-weight:700;">✓ Data Copied! Open Sheets & Press Ctrl+V</span>';
                        setTimeout(() => { btnSheets.innerHTML = origHTML; }, 4000);
                    } catch (err) {
                        alert("Failed to copy data. Your browser may be blocking it.");
                    }
                };

                setTimeout(() => document.getElementById('kpi-staff-list-container').scrollIntoView({ behavior: 'smooth' }), 100);
            }

            // Click Handlers for KPI Cards (Runs ONLY ONCE)
            ['kpi-card-full', 'kpi-card-partial', 'kpi-card-missed'].forEach(id => {
                const el = document.getElementById(id);
                if (el) {
                    el.onclick = () => {
                        document.querySelectorAll('.kpi-card').forEach(c => {
                            c.style.border = '1px solid var(--border-color)';
                            c.style.backgroundColor = 'var(--card-bg)';
                        });
                        
                        if (id === 'kpi-card-full') el.style.border = '2px solid #10b981';
                        else if (id === 'kpi-card-partial') el.style.border = '2px solid #f59e0b';
                        else if (id === 'kpi-card-missed') el.style.border = '2px solid #ef4444';

                        renderKpiTable(kpiCardsConfig[id].title, kpiCardsConfig[id].data);
                    };
                }
            });

            // Ensure close button is gone
            document.getElementById('close-kpi-list-btn')?.remove();

            if (window.opsBonusChartInstance) window.opsBonusChartInstance.destroy();
            if (window.opsBandChartInstance) window.opsBandChartInstance.destroy();

            window.opsBonusChartInstance = new Chart(ctxBonus, {
                type: 'bar',
                data: {
                    labels: labels,
                    datasets: [
                        { label: 'Full Bonus', data: fullData, backgroundColor: '#10b981' },
                        { label: '45% Collection Bonus', data: partialData, backgroundColor: '#f59e0b' }
                    ]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: { position: 'bottom', labels: { usePointStyle: true, padding: 20 } },
                        tooltip: { mode: 'index', intersect: false }
                    },
                    scales: {
                        x: { stacked: false },
                        y: { stacked: false, beginAtZero: true, ticks: { precision: 0 } }
                    }
                }
            });

            // Highly distinct, vivid colors for clear visual separation
            window.opsBandChartInstance = new Chart(ctxBand, {
                type: 'line',
                data: {
                    labels: labels,
                    datasets: [
                        { label: 'Elite (>500)', data: eliteBandData, borderColor: '#9333ea', backgroundColor: '#9333ea', tension: 0.3, borderWidth: 2 }, 
                        { label: 'Growth/Tension (351-500)', data: growthBandData, borderColor: '#10b981', backgroundColor: '#10b981', tension: 0.3, borderWidth: 2 }, 
                        { label: 'Baseline (201-350)', data: baselineBandData, borderColor: '#f59e0b', backgroundColor: '#f59e0b', tension: 0.3, borderWidth: 2 }, 
                        { label: 'Floor (<=200)', data: floorBandData, borderColor: '#ef4444', backgroundColor: '#ef4444', tension: 0.3, borderWidth: 2 } 
                    ]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: { position: 'bottom', labels: { usePointStyle: true, padding: 20 } },
                        tooltip: { mode: 'index', intersect: false }
                    },
                    scales: {
                        x: { stacked: false },
                        y: { stacked: false, beginAtZero: true, ticks: { precision: 0 } }
                    }
                }
            });
        };

        const renderDashboardData = (data, salary) => {
            const eligContainer = document.getElementById('eligibility-container');
            if (eligContainer) {
                if (data.eligibility.date_disqualified) {
                    eligContainer.innerHTML = `<div class="single-badge missed"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg> Bonus Missed</div>`;
                } 
                else if (data.eligibility.full_bonus) {
                    eligContainer.innerHTML = `<div class="single-badge full"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"></polyline></svg> Full Bonus Qualified</div>`;
                } 
                else if (data.eligibility.collection_bonus_45) {
                    eligContainer.innerHTML = `<div class="single-badge partial"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"></polyline></svg> 45% Collection Bonus Qualified</div>`;
                } 
                else {
                    eligContainer.innerHTML = `<div class="single-badge missed"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg> Bonus Missed</div>`;
                }
            }

            const totalPayoutEl = document.getElementById('res-total-payout');
            if (totalPayoutEl) {
                let warningEl = document.getElementById('payout-date-warning');
                
                if (!warningEl) {
                    warningEl = document.createElement('div');
                    warningEl.id = 'payout-date-warning';
                    totalPayoutEl.parentNode.insertBefore(warningEl, totalPayoutEl);
                }
                
                if (data.eligibility.date_disqualified) {
                    warningEl.innerHTML = `
                        <div style="background-color: #fef2f2; color: #b91c1c; border: 1px solid #fca5a5; padding: 10px 12px; border-radius: 8px; margin-bottom: 20px; font-size: 13.5px; display: flex; align-items: center; gap: 8px; text-align: left; font-weight: 500;">
                            <svg style="width: 16px; height: 16px; min-width: 16px;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
                            <div>You had not reported during this cycle</div>
                        </div>
                    `;
                    warningEl.style.display = 'block';
                } else {
                    warningEl.style.display = 'none';
                }
            }

            setElText('res-total-payout', formatKES(salary + data.current.base_bonus + data.collection.upside));
            setElText('res-basic-salary', formatKES(salary));
            setElText('res-bonus-earned', formatKES(data.current.base_bonus));
            setElText('res-founders-bonus', formatKES(data.collection.upside));
            
            const currentRange = formatRange(data.current.min, data.current.max);
            setElText('res-current-band-full', `${currentRange} (${data.current.band})`);
            
            if (data.eligibility.collection_bonus_45) {
                setElText('res-multiplier', `${(data.current.multiplier * 100).toFixed(2)}%`);
            } else {
                setElText('res-multiplier', `${data.current.multiplier.toFixed(2)}x`);
            }

            if (data.next_band && data.next_band.band !== "None") {
                setElText('hero-curr-band', `${data.current.band} (${currentRange})`);
                setElText('hero-next-band', `${data.next_band.band} (${formatRange(data.next_band.min, data.next_band.max)})`);
                if (document.getElementById('res-prog-fill')) document.getElementById('res-prog-fill').style.width = `${data.next_band.progress_percent}%`;
                setElText('res-prog-text', `${data.current.customers} / ${data.next_band.threshold} customers total`);
                setElText('res-cust-needed', data.next_band.customers_needed);
                setElText('res-pot-earnings', formatKES(data.next_band.potential_bonus));
                setElText('res-growth-value', `+ ${formatKES(data.next_band.bonus_opportunity)}`);
            } else {
                setElText('hero-curr-band', `${data.current.band} (${currentRange})`);
                setElText('hero-next-band', 'Max Tier');
                if (document.getElementById('res-prog-fill')) document.getElementById('res-prog-fill').style.width = `100%`;
                setElText('res-prog-text', `${data.current.customers} customers (Max)`);
                setElText('res-cust-needed', '-');
                setElText('res-pot-earnings', '-');
                setElText('res-growth-value', '-');
            }
        };

        const runCalculation = async () => {
            if (!viewedUser) return;
            const getVal = (id) => parseFloat(document.getElementById(id)?.value) || 0;

            const selectedMonth = document.getElementById('month-filter')?.value;
            const activeProfile = getActiveProfile(viewedUser, selectedMonth);

            const currentMetrics = {
                disbursement: getVal('disbursement'), active_customers: getVal('active_customers'),
                new_customers: getVal('new_customers'), otc: getVal('otc'),
                dd7: getVal('dd7'), new_customer_otc: getVal('new_customer_otc')
            };

            const updateRowUI = (key, diffId, statusId) => {
                let diff = currentMetrics[key] - TARGETS[key];
                let isMet = currentMetrics[key] >= TARGETS[key];

                // WAIVE SPECIFICALLY NEW CUSTOMER OTC FOR JULY 2026 AND EARLIER
                if (key === 'new_customer_otc' && selectedMonth <= '202607') {
                    const statusEl = document.getElementById(statusId);
                    if (statusEl) statusEl.innerHTML = `<span class="status-badge met" style="background: #3b82f6;">✓ Waived</span>`;
                    const diffEl = document.getElementById(diffId);
                    if (diffEl) { diffEl.textContent = 'N/A'; diffEl.className = 'diff-val'; }
                    return;
                }

                const diffEl = document.getElementById(diffId);
                if (diffEl) {
                    diffEl.textContent = `${diff > 0 ? '+' : ''}${diff.toFixed(2)}%`;
                    diffEl.className = `diff-val ${diff >= 0 ? 'positive' : 'negative'}`;
                }
                const statusEl = document.getElementById(statusId);
                if (statusEl) {
                    statusEl.innerHTML = isMet 
                        ? `<span class="status-badge met">✓ Met</span>` 
                        : `<span class="status-badge missed">✕ Not Met</span>`;
                }
            };

            ['disbursement','active_customers','new_customers','otc','dd7','new_customer_otc'].forEach((k, i) => {
                updateRowUI(k, ['diff-disbursement','diff-active-customers','diff-new-customers','diff-otc','diff-dd7','diff-new-cust-otc'][i], ['status-disbursement','status-active-customers','status-new-customers','status-otc','status-dd7','status-new-cust-otc'][i]);
            });

            let disbActualVal = 0;

            if (viewedUser.performance && viewedUser.performance[selectedMonth]) {
                const p = viewedUser.performance[selectedMonth];
                disbActualVal = parseFloat(p.disb_actual) || 0;
                setElText('fig-disb-actual', formatKES(p.disb_actual || 0));
                setElText('fig-disb-target', formatKES(p.disb_target || 0));
                setElText('fig-ac-actual', p.ac_actual || 0);
                setElText('fig-ac-target', p.ac_target || 0);
                setElText('fig-nc-actual', p.nc_actual || 0);
                setElText('fig-nc-target', p.nc_target || 0);
                setElText('fig-otc-val', `${(parseFloat(p.overall_otc) || 0).toFixed(2)}%`);
                setElText('fig-dd7-val', `${(parseFloat(p.dd7_rate) || 0).toFixed(2)}%`);
                setElText('fig-new-otc-val', `${currentMetrics.new_customer_otc.toFixed(2)}%`);
            } else {
                ['fig-disb-actual','fig-disb-target','fig-ac-actual','fig-ac-target','fig-nc-actual','fig-nc-target'].forEach(id => setElText(id, id.includes('disb') ? 'KSh 0' : '0'));
                ['fig-otc-val','fig-dd7-val','fig-new-otc-val'].forEach(id => setElText(id, '0.00%'));
            }

            let fixedSalary = 29108; 
            const roleUpper = (activeProfile.type || '').toUpperCase();
            const pairsStr = String(activeProfile.pairs || '');

            if (roleUpper.includes('BM') || roleUpper.includes('MANAGER')) {
                if (pairsStr.includes('3')) fixedSalary = 77000;
                else if (pairsStr.includes('2')) fixedSalary = 67507;
                else fixedSalary = 45397; 
            }

            // GUARANTEE PYTHON NEVER DISQUALIFIES HISTORICAL TRANSFERS DUE TO DATE
            let safeDateReported = viewedUser.date_reported || "";
            if (activeProfile.isHistorical) {
                safeDateReported = ""; // Pass an empty string so Python skips the date check completely
            }

            const payload = {
                employee_name: viewedUser.name, 
                employee_id: viewedUser.id, 
                employee_type: activeProfile.type, 
                pairs: activeProfile.pairs,
                salary: fixedSalary, 
                customers: parseInt(document.getElementById('customers')?.value) || 0, 
                disb_actual: disbActualVal,
                disbursement: currentMetrics.disbursement / 100, active_customers: currentMetrics.active_customers / 100,
                new_customers: currentMetrics.new_customers / 100, otc: currentMetrics.otc / 100, dd7: currentMetrics.dd7 / 100, new_customer_otc: currentMetrics.new_customer_otc / 100,
                date_reported: safeDateReported,
                month: selectedMonth,
                is_previous: activeProfile.isHistorical // Explicitly notify Python backend of transfer status
            };

            try {
                const res = await fetch('/api/calculate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
                const data = await res.json();
                
                if (data.success) {
                    
                    if (activeProfile.isHistorical) {
                        data.eligibility.date_disqualified = false;
                    } 
                    else if (checkLateReporting(viewedUser, selectedMonth)) {
                        data.eligibility.date_disqualified = true;
                        data.eligibility.full_bonus = false;
                        data.eligibility.collection_bonus_45 = false;
                        data.current.base_bonus = 0;
                        data.collection.upside = 0;
                        if (data.next_band) {
                            data.next_band.potential_bonus = 0;
                            data.next_band.bonus_opportunity = 0;
                        }
                    }
                    renderDashboardData(data, payload.salary);
                } else {
                    console.error("Calculate API returned success: false");
                }
            } catch (err) { console.error("Calculation Error:", err); }
        };

        const applyMonthPerformance = () => {
            if (!viewedUser) return;
            const selectedMonth = document.getElementById('month-filter')?.value;
            
            const activeProfile = getActiveProfile(viewedUser, selectedMonth);
            
            const branchEl = document.getElementById('emp-info-branch');
            if (branchEl) {
                if (activeProfile.isHistorical) {
                    branchEl.innerHTML = `${activeProfile.branch} <span style="color: var(--primary-amber); font-size: 10px;">(Previous)</span>`;
                } else {
                    branchEl.textContent = activeProfile.branch;
                }
            }
            
            setElText('emp-info-role', activeProfile.type);
            setElText('emp-info-pairs', activeProfile.pairs);

            let fixedSalary = 29108; 
            const roleUpper = (activeProfile.type || '').toUpperCase();
            const pairsStr = String(activeProfile.pairs || '');

            if (roleUpper.includes('BM') || roleUpper.includes('MANAGER')) {
                if (pairsStr.includes('3')) fixedSalary = 77000;
                else if (pairsStr.includes('2')) fixedSalary = 67507;
                else fixedSalary = 45397; 
            }

            const salaryEl = document.getElementById('emp-info-salary');
            if (salaryEl) salaryEl.textContent = formatKES(fixedSalary);

            if (viewedUser.performance && viewedUser.performance[selectedMonth]) {
                const p = viewedUser.performance[selectedMonth];
                const getRate = (a, t, rate) => (t > 0 && !isNaN(a) && !isNaN(t)) ? ((a / t) * 100).toFixed(2) : (rate ? (parseFloat(String(rate).replace('%','')) <= 1 ? (parseFloat(rate)*100).toFixed(2) : parseFloat(rate).toFixed(2)) : "0.00");
                const parseRate = (v) => (!v) ? "0.00" : (parseFloat(String(v).replace('%','')) <= 1 ? (parseFloat(v)*100).toFixed(2) : parseFloat(v).toFixed(2));

                document.getElementById('disbursement').value = getRate(p.disb_actual, p.disb_target, p.disb_rate);
                document.getElementById('active_customers').value = getRate(p.ac_actual, p.ac_target, p.ac_rate);
                document.getElementById('new_customers').value = getRate(p.nc_actual, p.nc_target, p.nc_rate);
                document.getElementById('otc').value = parseRate(p.overall_otc);
                document.getElementById('dd7').value = parseRate(p.dd7_rate);
                document.getElementById('new_customer_otc').value = parseRate(p.new_customer_otc);
                if (document.getElementById('customers')) document.getElementById('customers').value = parseInt(p.ac_actual) || 0;
            } else {
                ['disbursement','active_customers','new_customers','otc','dd7','new_customer_otc','customers'].forEach(id => { if (document.getElementById(id)) document.getElementById(id).value = 0; });
            }
            
            runCalculation();
        };

        const setupMonthFilter = () => {
            const selectEl = document.getElementById('month-filter');
            if (!selectEl) return;

            const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
            const today = new Date();
            const targetDefaultDate = new Date(today.getFullYear(), today.getMonth() - 2, 1);
            const maxMonthCode = `${targetDefaultDate.getFullYear()}${String(targetDefaultDate.getMonth() + 1).padStart(2, '0')}`;

            const monthCodesSet = new Set();
            if (viewedUser && viewedUser.performance) {
                Object.keys(viewedUser.performance).forEach(m => {
                    if (m <= maxMonthCode) monthCodesSet.add(m);
                });
            }
            
            for (let i = 2; i < 14; i++) {
                const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
                monthCodesSet.add(`${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}`);
            }

            const sortedMonthCodes = Array.from(monthCodesSet).sort((a, b) => b.localeCompare(a));
            selectEl.innerHTML = '';
            sortedMonthCodes.forEach(mCode => {
                if (mCode.length === 6) {
                    const year = mCode.substring(0, 4);
                    const monthIdx = parseInt(mCode.substring(4, 6), 10) - 1;
                    const opt = document.createElement('option');
                    opt.value = mCode; opt.textContent = `${monthNames[monthIdx] || ''} ${year}`;
                    selectEl.appendChild(opt);
                }
            });

            if (selectEl.querySelector(`option[value="${maxMonthCode}"]`)) selectEl.value = maxMonthCode;
            else if (selectEl.options.length > 0) selectEl.selectedIndex = 0;
            
            selectEl.removeEventListener('change', applyMonthPerformance); 
            selectEl.addEventListener('change', applyMonthPerformance);
        };

        const updateProfileUI = (user) => {
            setElText('top-user-name', user.name);
            setElText('top-user-role', `${user.type} • ${user.branch}`);
            setElText('modal-emp-name', user.name);
            setElText('modal-emp-id', user.id);
            setElText('modal-emp-role', user.type);
            setElText('modal-emp-branch', user.branch);
            setElText('modal-emp-pairs', user.pairs);
            setElText('modal-emp-email', user.email || '-');

            const avatarContainer = document.getElementById('top-user-avatar');
            if (avatarContainer && user.picture) {
                avatarContainer.innerHTML = `<img src="${user.picture}" alt="Profile" style="width: 100%; height: 100%; object-fit: cover; border-radius: 50%;">`;
                avatarContainer.style.background = 'transparent';
                avatarContainer.style.border = 'none';
                avatarContainer.style.padding = '0';
            }

            const modalAvatarWrap = document.getElementById('modal-user-avatar-wrap');
            if (modalAvatarWrap && user.picture) {
                modalAvatarWrap.innerHTML = `<img src="${user.picture}" alt="Profile" style="width: 100%; height: 100%; object-fit: cover;">`;
            }
        };

        const updateDashboardUI = (user) => {
            const welcomeTitle = document.querySelector('.welcome-title');
            if (welcomeTitle) {
                if (isImpersonating) {
                    welcomeTitle.innerHTML = `Viewing Staff Performance: <span id="hero-user-firstname">${user.name.split(' ')[0]}</span>`;
                } else {
                    welcomeTitle.innerHTML = `Welcome back, <span id="hero-user-firstname">${user.name.split(' ')[0]}</span>`;
                }
            }

            setElText('emp-info-name', user.name);
            setElText('emp-info-id', user.id);
            
            setupMonthFilter();
            applyMonthPerformance(); 
        };

        window.impersonateStaff = (email) => {
            const targetStaff = allStaffData.find(s => s.email === email);
            if (!targetStaff) return;

            isImpersonating = true;
            
            const impersonationUser = JSON.parse(JSON.stringify(targetStaff));
            computePerformanceForUser(impersonationUser, rawPerformance);
            
            viewedUser = impersonationUser;
            updateDashboardUI(viewedUser);

            const dashNav = document.getElementById('main-nav-item');
            if (dashNav) {
                dashNav.setAttribute('data-view', 'dashboard');
                dashNav.querySelector('.menu-text').textContent = 'Dashboard';
            }

            document.getElementById('impersonation-banner').style.display = 'flex';
            document.getElementById('impersonation-name').textContent = viewedUser.name;
            
            const kpiList = document.getElementById('kpi-staff-list-container');
            if (kpiList) kpiList.style.display = 'none';

            handleNavigation('dashboard');
        };

        document.getElementById('btn-exit-impersonation')?.addEventListener('click', () => {
            isImpersonating = false;
            viewedUser = loggedInUser;
            document.getElementById('impersonation-banner').style.display = 'none';
            updateDashboardUI(viewedUser);
            
            const dashNav = document.getElementById('main-nav-item');
            if (dashNav) {
                dashNav.setAttribute('data-view', 'ops');
                dashNav.querySelector('.menu-text').textContent = 'Overview';
            }
            handleNavigation('ops');
        });

        document.querySelectorAll('.ops-tab-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.ops-tab-btn').forEach(b => b.classList.remove('active'));
                document.querySelectorAll('.ops-tab-content').forEach(c => c.style.display = 'none');
                btn.classList.add('active');
                document.getElementById(btn.getAttribute('data-tab')).style.display = 'block';
            });
        });

        document.querySelectorAll('.menu-item').forEach(item => {
            item.addEventListener('click', () => {
                const view = item.getAttribute('data-view');
                const href = item.getAttribute('data-href');
                
                if (view && document.getElementById(`view-${view}`)) {
                    handleNavigation(view);
                } 
                else if (href) {
                    window.location.href = href;
                } 
                else if (view === 'dashboard' || view === 'ops') {
                    window.location.href = '/overview';
                }
            });
        });

        document.getElementById('ops-search-input')?.addEventListener('input', (e) => {
            const term = e.target.value.toLowerCase();
            filteredStaff = allStaffData.filter(staff => {
                const searchStr = `${staff.name} ${staff.branch} ${staff.type}`.toLowerCase();
                return searchStr.includes(term);
            });
            currentPage = 1;
            renderOpsStaffTable();
        });

        document.getElementById('ops-page-prev')?.addEventListener('click', () => {
            if (currentPage > 1) { currentPage--; renderOpsStaffTable(); }
        });
        document.getElementById('ops-page-next')?.addEventListener('click', () => {
            const totalPages = Math.ceil(filteredStaff.length / pageSize) || 1;
            if (currentPage < totalPages) { currentPage++; renderOpsStaffTable(); }
        });
        document.getElementById('ops-page-size')?.addEventListener('change', (e) => {
            pageSize = parseInt(e.target.value);
            currentPage = 1;
            renderOpsStaffTable();
        });

        document.getElementById('calculator-form')?.addEventListener('submit', (e) => { e.preventDefault(); runCalculation(); });

        if (!cachedUserStr) {
            window.location.href = '/';
        } else {
            try {
                currentUser = JSON.parse(cachedUserStr);
                loggedInUser = currentUser;
                viewedUser = loggedInUser;

                updateProfileUI(loggedInUser);
                updateDashboardUI(viewedUser);

                const userRole = (loggedInUser.type || '').toUpperCase();
                const sidebarMenu = document.querySelector('.sidebar-menu');

                if (loggedInUser.is_ops) {
                    const token = sessionStorage.getItem('upia_google_token');
                    if (token) {
                        // 1. INSTANT RENDER FROM BROWSER MEMORY
                        const cachedStaffStr = sessionStorage.getItem('upia_ops_staff');
                        const cachedPerfStr = sessionStorage.getItem('upia_ops_perf');
                        
                        if (cachedStaffStr && cachedPerfStr) {
                            try {
                                allStaffData = JSON.parse(cachedStaffStr);
                                filteredStaff = allStaffData;
                                rawPerformance = JSON.parse(cachedPerfStr);
                                
                                const skelStaff = document.getElementById('skeleton-staff-tbody');
                                const skelAnalytics = document.getElementById('ops-analytics-skeleton');
                                if (skelStaff) skelStaff.style.display = 'none';
                                if (skelAnalytics) skelAnalytics.style.display = 'none';
                                
                                document.getElementById('ops-staff-tbody').style.display = 'table-row-group';
                                document.getElementById('ops-analytics-content').style.display = 'block';
                                
                                renderOpsStaffTable();
                                renderOpsAnalytics(rawPerformance);
                            } catch(e) { console.error('Cache restore error', e); }
                        }

                        // 2. SILENT BACKGROUND FETCH (Does not block the screen!)
                        fetch('/api/auth/google', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ credential: token })
                        })
                        .then(res => res.json())
                        .then(data => {
                            if (data && data.success) {
                                setTimeout(() => {
                                    const newStaffStr = JSON.stringify(data.all_staff || []);
                                    const newPerfStr = JSON.stringify(data.raw_performance || {});
                                    
                                    // 3. ONLY RE-RENDER IF THE DATA ACTUALLY CHANGED
                                    if (newStaffStr !== cachedStaffStr || newPerfStr !== cachedPerfStr) {
                                        if (data.all_staff) {
                                            allStaffData = data.all_staff;
                                            filteredStaff = allStaffData;
                                            sessionStorage.setItem('upia_ops_staff', newStaffStr);
                                        }
                                        if (data.raw_performance) {
                                            rawPerformance = data.raw_performance;
                                            sessionStorage.setItem('upia_ops_perf', newPerfStr);
                                        }
                                        
                                        renderOpsStaffTable();
                                        renderOpsAnalytics(rawPerformance);
                                        
                                        const skelStaff = document.getElementById('skeleton-staff-tbody');
                                        const dataStaff = document.getElementById('ops-staff-tbody');
                                        if (skelStaff) skelStaff.style.display = 'none';
                                        if (dataStaff) dataStaff.style.display = 'table-row-group';

                                        const skelAnalytics = document.getElementById('ops-analytics-skeleton');
                                        const dataAnalytics = document.getElementById('ops-analytics-content');
                                        if (skelAnalytics) skelAnalytics.style.display = 'none';
                                        if (dataAnalytics) dataAnalytics.style.display = 'block';
                                    }
                                }, 100); // Wait 100ms so network thread yields to UI thread
                            }
                        })
                        .catch(err => console.error("Error fetching ops data:", err));
                    }
                }

                if (userRole.includes('ADMIN')) {
                    if (sidebarMenu && !document.getElementById('nav-admin-portal')) {
                        const adminLi = document.createElement('li');
                        adminLi.className = 'menu-item';
                        adminLi.id = 'nav-admin-portal';
                        adminLi.innerHTML = `<svg class="ui-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path></svg><span class="menu-text" style="color: var(--danger); font-weight: 700;">Admin Portal</span>`;
                        adminLi.addEventListener('click', () => window.location.href = '/admin');
                        sidebarMenu.appendChild(adminLi);
                    }
                }

            } catch (e) {
                console.error("Dashboard initialization error:", e);
            }
        }
    }
})();


if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js')
            .then(reg => console.log('PWA Service Worker registered successfully.'))
            .catch(err => console.error('PWA Service Worker registration failed:', err));
    });
}

let deferredPrompt;
const installBtn = document.getElementById('install-app-btn');

if (installBtn) {
    installBtn.style.display = 'none'; 
}

window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    if (installBtn) {
        installBtn.style.display = 'flex';
    }
});

if (installBtn) {
    installBtn.addEventListener('click', async () => {
        if (deferredPrompt) {
            deferredPrompt.prompt();
            const { outcome } = await deferredPrompt.userChoice;
            console.log(`User install outcome: ${outcome}`);
            deferredPrompt = null;
            installBtn.style.display = 'none';
        }
    });
}

window.addEventListener('appinstalled', () => {
    if (installBtn) {
        installBtn.style.display = 'none';
    }
    deferredPrompt = null;
    console.log('PWA installed successfully.');
});

document.addEventListener('click', (e) => {
    if (e.target.closest('#top-user-avatar')) {
        const modal = document.getElementById('mobile-profile-modal');
        if (modal) modal.classList.add('active');
    }

    if (e.target.closest('#close-profile-modal') || e.target.id === 'mobile-profile-modal') {
        const modal = document.getElementById('mobile-profile-modal');
        if (modal) modal.classList.remove('active');
    }

    const metricRow = e.target.closest('.metric-row');
    if (metricRow && e.target.tagName !== 'INPUT') {
        const metricKey = metricRow.getAttribute('data-metric');
        const detailsRow = document.getElementById(`details-${metricKey}`);
        if (detailsRow) {
            metricRow.classList.toggle('expanded');
            detailsRow.classList.toggle('show');
        }
    }

    const themeBtn = e.target.closest('#theme-toggle-btn');
    if (themeBtn) {
        const sunSVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20"><circle cx="12" cy="12" r="5"></circle><line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line><line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line></svg>`;
        const moonSVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg>`;

        const currentTheme = document.documentElement.getAttribute('data-theme');
        const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
        document.documentElement.setAttribute('data-theme', newTheme);
        localStorage.setItem('theme', newTheme);
        themeBtn.innerHTML = newTheme === 'light' ? moonSVG : sunSVG;
        
        setTimeout(window.renderGoogleButton, 50);
    }
});

document.getElementById('btn-logout-drawer')?.addEventListener('click', () => { 
    sessionStorage.clear(); 
    window.location.href = '/'; 
});

// ==========================================
// FORCE SYNC & CLEAR CACHE BUTTON
// ==========================================
document.getElementById('btn-force-sync')?.addEventListener('click', (e) => {
    const btn = e.currentTarget;
    btn.innerHTML = `<span style="opacity: 0.7;">Syncing Database...</span>`;
    btn.style.pointerEvents = 'none';

    // This is the exact command you were typing in the console!
    fetch('/api/config/reload', { method: 'POST' })
        .then(res => res.json())
        .then(() => {
            sessionStorage.clear(); // Wipes the stale browser memory
            window.location.reload(true); // Forces a hard refresh of the page
        })
        .catch(err => {
            console.error(err);
            btn.innerHTML = 'Sync Failed';
            btn.style.pointerEvents = 'auto';
        });
});

document.getElementById('btn-logout-drawer')?.addEventListener('click', async () => { 
    try {
        // Send fast logout signal to clear backend Redis cache
        await fetch('/api/auth/logout', { method: 'POST' });
    } catch (e) {
        console.warn('Logout endpoint warning:', e);
    }
    sessionStorage.clear(); 
    window.location.href = '/'; 
});

document.addEventListener('DOMContentLoaded', () => {
    const themeBtn = document.getElementById('theme-toggle-btn');
    if (themeBtn) {
        const initialTheme = document.documentElement.getAttribute('data-theme') || 'light';
        const sunSVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20"><circle cx="12" cy="12" r="5"></circle><line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line><line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line></svg>`;
        const moonSVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg>`;
        themeBtn.innerHTML = initialTheme === 'light' ? moonSVG : sunSVG;
    }
});

let chatSyncInterval = null;
let currentOpsChatTarget = null;

const initChatSystem = () => {
    const userStr = sessionStorage.getItem('upia_user');
    if (!userStr) return;
    const user = JSON.parse(userStr);

    const openChatBtn = document.getElementById('open-chat-btn');
    const chatDrawer = document.getElementById('chat-drawer');
    const chatOverlay = document.getElementById('chat-drawer-overlay');
    const closeChatBtn = document.getElementById('close-chat-btn');
    const chatBackBtn = document.getElementById('chat-back-btn');

    if (openChatBtn && chatDrawer) {
        openChatBtn.addEventListener('click', () => {
            chatDrawer.classList.add('open');
            if (chatOverlay) chatOverlay.classList.add('show');
            
            const ticketList = document.getElementById('ops-ticket-list');
            const threadView = document.getElementById('chat-thread-view');
            
            if (user.is_ops) {
                currentOpsChatTarget = null; 
                if (ticketList) ticketList.style.display = 'block';
                if (threadView) threadView.style.display = 'none';
                document.getElementById('chat-header-title').textContent = 'Support Tickets';
                if (chatBackBtn) chatBackBtn.style.display = 'none';
            } else {
                if (ticketList) ticketList.style.display = 'none';
                if (threadView) threadView.style.display = 'flex';
                document.getElementById('chat-header-title').textContent = 'Support Chat';
            }
            
            syncChatData(); 
        });
    }

    const closeDrawer = () => {
        if (chatDrawer) chatDrawer.classList.remove('open');
        if (chatOverlay) chatOverlay.classList.remove('show');
    };
    if (closeChatBtn) closeChatBtn.addEventListener('click', closeDrawer);
    if (chatOverlay) chatOverlay.addEventListener('click', closeDrawer);

    if (chatBackBtn) {
        chatBackBtn.addEventListener('click', () => {
            currentOpsChatTarget = null;
            const ticketList = document.getElementById('ops-ticket-list');
            const threadView = document.getElementById('chat-thread-view');
            
            if (ticketList) ticketList.style.display = 'block';
            if (threadView) threadView.style.display = 'none';
            chatBackBtn.style.display = 'none';
            document.getElementById('chat-header-title').textContent = 'Support Tickets';
        });
    }

    const chatSendBtn = document.getElementById('chat-send-btn');
    const chatInput = document.getElementById('chat-input');
    if (chatSendBtn && chatInput) {
        chatSendBtn.addEventListener('click', () => sendChatMessage(chatInput.value, currentOpsChatTarget));
        chatInput.addEventListener('keypress', (e) => { 
            if(e.key === 'Enter') sendChatMessage(chatInput.value, currentOpsChatTarget); 
        });
    }

    if (chatSyncInterval) clearInterval(chatSyncInterval);
    chatSyncInterval = setInterval(syncChatData, 5000);
};

const sendChatMessage = async (msgText, targetEmail = null) => {
    if (!msgText.trim()) return;
    const user = JSON.parse(sessionStorage.getItem('upia_user'));
    
    const inputField = document.getElementById('chat-input');
    if (inputField) inputField.value = '';

    try {
        const res = await fetch('/api/chat/sync', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                email: user.email,
                name: user.name, 
                is_ops: user.is_ops,
                message: msgText,
                target_email: targetEmail
            })
        });
        const data = await res.json();
        if (data.success) renderChatUI(data.chats, user);
    } catch (e) {
        console.error("Chat send failed", e);
    }
};

const syncChatData = async () => {
    const userStr = sessionStorage.getItem('upia_user');
    if (!userStr) return;
    const user = JSON.parse(userStr);

    const drawerOpen = document.getElementById('chat-drawer')?.classList.contains('open');
    if (!drawerOpen) return; 

    try {
        const res = await fetch('/api/chat/sync', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: user.email, is_ops: user.is_ops })
        });
        const data = await res.json();
        if (data.success) renderChatUI(data.chats, user);
    } catch (e) {
        console.error("Chat sync failed", e);
    }
};

const renderChatUI = (chatData, user) => {
    const formatTime = (ts) => {
        return new Date(ts * 1000).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    };

    const renderMessages = (messagesArray, viewerIsOps) => {
        const msgContainer = document.getElementById('chat-messages');
        if (!msgContainer) return;
        
        msgContainer.innerHTML = '';
        if (!messagesArray || messagesArray.length === 0) {
            msgContainer.innerHTML = '<div style="text-align: center; color: var(--text-muted); font-size: 13px; margin-top: 30px;">No messages yet.<br>Type below to start the conversation!</div>';
            return;
        }

        messagesArray.forEach(msg => {
            const isMe = (viewerIsOps && msg.sender_role === 'ops') || (!viewerIsOps && msg.sender_role === 'staff');
            
            const wrapper = document.createElement('div');
            wrapper.style.cssText = `display: flex; flex-direction: column; max-width: 85%; ${isMe ? 'align-self: flex-end;' : 'align-self: flex-start;'}`;
            
            const auditHeader = document.createElement('div');
            auditHeader.style.cssText = `font-size: 10.5px; font-weight: 600; color: var(--text-muted); margin-bottom: 4px; ${isMe ? 'text-align: right;' : 'text-align: left;'}`;
            auditHeader.textContent = `${msg.sender_name} (${msg.sender_role === 'ops' ? 'Admin/Ops' : 'Staff'}) • ${formatTime(msg.timestamp)}`;
            
            const bubble = document.createElement('div');
            bubble.style.cssText = `padding: 12px 16px; border-radius: 12px; line-height: 1.4; ${isMe ? 'background: var(--primary-color); color: white; border-bottom-right-radius: 4px;' : 'background: #e2e8f0; color: #1e293b; border-bottom-left-radius: 4px;'}`;
            
            if (!isMe && document.documentElement.getAttribute('data-theme') === 'dark') {
                bubble.style.background = '#334155';
                bubble.style.color = '#f8fafc';
            }
            
            bubble.textContent = msg.text;
            
            wrapper.appendChild(auditHeader);
            wrapper.appendChild(bubble);
            msgContainer.appendChild(wrapper);
        });
        msgContainer.scrollTop = msgContainer.scrollHeight;
    };

    if (!user.is_ops) {
        renderMessages(chatData, false);
    } else {
        const threadList = document.getElementById('ops-ticket-list');
        if (threadList) {
            threadList.innerHTML = '';
            
            const sortedChats = Object.entries(chatData).sort((a, b) => {
                const lastA = a[1].length > 0 ? a[1][a[1].length - 1].timestamp : 0;
                const lastB = b[1].length > 0 ? b[1][b[1].length - 1].timestamp : 0;
                return lastB - lastA;
            });

            if (sortedChats.length === 0) {
                threadList.innerHTML = '<div style="padding: 20px; text-align: center; color: var(--text-muted); font-size: 13px;">No support tickets found.</div>';
            }

            sortedChats.forEach(([email, msgs]) => {
                if (msgs.length === 0) return;
                
                const lastMsg = msgs[msgs.length - 1];
                const threadEl = document.createElement('div');
                
                threadEl.style.cssText = `padding: 16px; border-bottom: 1px solid var(--border-color); cursor: pointer; transition: background 0.2s;`;
                
                const previewPrefix = lastMsg.sender_role === 'ops' 
                    ? `<strong style="color: var(--primary-color);">${lastMsg.sender_name}:</strong> ` 
                    : `<strong style="color: #f59e0b;">Action Required:</strong> `;

                threadEl.innerHTML = `
                    <div style="font-weight: 600; font-size: 14px; color: var(--text-color); margin-bottom: 4px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${email}</div>
                    <div style="font-size: 12px; color: var(--text-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                        ${previewPrefix} ${lastMsg.text}
                    </div>
                    <div style="font-size: 10px; color: var(--text-muted); margin-top: 6px;">Last updated: ${formatTime(lastMsg.timestamp)}</div>
                `;
                
                threadEl.addEventListener('click', () => {
                    currentOpsChatTarget = email;
                    document.getElementById('ops-ticket-list').style.display = 'none';
                    document.getElementById('chat-thread-view').style.display = 'flex';
                    document.getElementById('chat-back-btn').style.display = 'inline-block';
                    document.getElementById('chat-header-title').textContent = "Ticket: " + email;
                    
                    renderMessages(chatData[email], true);
                });
                
                threadList.appendChild(threadEl);
            });
        }
        
        if (currentOpsChatTarget && chatData[currentOpsChatTarget]) {
            renderMessages(chatData[currentOpsChatTarget], true);
        }
    }
};

setTimeout(initChatSystem, 1500);