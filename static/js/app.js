(() => {
    "use strict";

    const formatKES = (num) => new Intl.NumberFormat('en-KE', { style: 'currency', currency: 'KES', maximumFractionDigits: 0 }).format(num);

    const TARGETS = { disbursement: 98.0, active_customers: 95.0, new_customers: 95.0, otc: 91.5, dd7: 94.0, new_customer_otc: 90.0 };

    const themeBtn = document.getElementById('theme-toggle-btn');
    if (themeBtn) {
        const sunSVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 20px; height: 20px;"><circle cx="12" cy="12" r="5"></circle><line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line><line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line></svg>`;
        const moonSVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 20px; height: 20px;"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg>`;

        const initialTheme = document.documentElement.getAttribute('data-theme') || 'light';
        themeBtn.innerHTML = initialTheme === 'light' ? moonSVG : sunSVG;

        themeBtn.addEventListener('click', function() {
            const newTheme = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
            document.documentElement.setAttribute('data-theme', newTheme);
            localStorage.setItem('theme', newTheme);
            themeBtn.innerHTML = newTheme === 'light' ? moonSVG : sunSVG;
        });
    }

    // Helper function to decode the Google JWT and extract the profile picture
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
                // Extract picture from Google Token
                const googlePayload = decodeJwt(response.credential);
                const finalUser = data.user;
                if (googlePayload.picture) {
                    finalUser.picture = googlePayload.picture;
                }

                sessionStorage.setItem('upia_google_token', response.credential);
                sessionStorage.setItem('upia_user', JSON.stringify(finalUser)); 
                
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
            document.querySelectorAll('.view-panel').forEach(panel => panel.style.display = 'none');
            document.querySelectorAll('.menu-item').forEach(item => item.classList.remove('active'));

            const activePanel = document.getElementById(`view-${targetView}`);
            if (activePanel) activePanel.style.display = 'block';

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
                tr.innerHTML = `
                    <td style="font-weight: 600;">${staff.name}</td>
                    <td>${staff.branch || '-'}</td>
                    <td>${staff.pairs || '-'}</td>
                    <td>${staff.type || '-'}</td>
                    <td><button class="btn-view-staff" onclick="impersonateStaff('${staff.email}')">View</button></td>
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

            const today = new Date();
            const maxDate = new Date(today.getFullYear(), today.getMonth() - 2, 1);
            const maxMonthCode = `${maxDate.getFullYear()}${String(maxDate.getMonth() + 1).padStart(2, '0')}`;

            const monthSet = new Set();
            allStaffData.forEach(staff => {
                if (staff.performance) {
                    Object.keys(staff.performance).forEach(m => {
                        if (m <= maxMonthCode) {
                            monthSet.add(m);
                        }
                    });
                }
            });
            const sortedMonths = Array.from(monthSet).sort();

            const checkEligibility = (p) => {
                const getRate = (a, t, rate) => (t > 0 && !isNaN(a) && !isNaN(t)) ? ((a / t) * 100) : (rate ? (parseFloat(String(rate).replace('%','')) <= 1 ? (parseFloat(rate)*100) : parseFloat(rate)) : 0.0);
                const parseRate = (v) => (!v) ? 0.0 : (parseFloat(String(v).replace('%','')) <= 1 ? (parseFloat(v)*100) : parseFloat(v));

                const disb = getRate(p.disb_actual, p.disb_target, p.disb_rate);
                const ac = getRate(p.ac_actual, p.ac_target, p.ac_rate);
                const nc = getRate(p.nc_actual, p.nc_target, p.nc_rate);
                const otc = parseRate(p.overall_otc);
                const dd7 = parseRate(p.dd7_rate);
                const nc_otc = parseRate(p.new_customer_otc);

                const round2 = (num) => Math.round((num + Number.EPSILON) * 100) / 100;

                const passes_nc_otc = round2(nc_otc) >= 90.00;
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
                    const p = staff.performance ? staff.performance[mCode] : null;
                    if (p) {
                        const elig = checkEligibility(p);
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

            const renderKpiTable = (title, data) => {
                document.getElementById('kpi-staff-list-title').textContent = title;
                const tbody = document.getElementById('kpi-staff-tbody');
                tbody.innerHTML = '';
                
                const sortedData = data.sort((a, b) => b.customers - a.customers);

                sortedData.forEach(staff => {
                    const tr = document.createElement('tr');
                    tr.innerHTML = `
                        <td style="font-weight: 600;">${staff.name}</td>
                        <td>${staff.branch || '-'}</td>
                        <td>${staff.type || '-'}</td>
                        <td>${staff.customers}</td>
                        <td><button class="btn-view-staff" onclick="impersonateStaff('${staff.email}')">View Dashboard</button></td>
                    `;
                    tbody.appendChild(tr);
                });
                document.getElementById('kpi-staff-list-container').style.display = 'block';
                setTimeout(() => document.getElementById('kpi-staff-list-container').scrollIntoView({ behavior: 'smooth' }), 100);
            };

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

            const closeBtn = document.getElementById('close-kpi-list-btn');
            if (closeBtn) {
                closeBtn.onclick = () => {
                    document.getElementById('kpi-staff-list-container').style.display = 'none';
                    document.querySelectorAll('.kpi-card').forEach(c => {
                        c.style.border = '1px solid var(--border-color)';
                    });
                };
            }

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

            window.opsBandChartInstance = new Chart(ctxBand, {
                type: 'line',
                data: {
                    labels: labels,
                    datasets: [
                        { label: 'Elite (>500)', data: eliteBandData, borderColor: '#8b5cf6', backgroundColor: '#8b5cf6', tension: 0.3, borderWidth: 2 },
                        { label: 'Growth/Tension (351-500)', data: growthBandData, borderColor: '#3b82f6', backgroundColor: '#3b82f6', tension: 0.3, borderWidth: 2 },
                        { label: 'Baseline (201-350)', data: baselineBandData, borderColor: '#0ea5e9', backgroundColor: '#0ea5e9', tension: 0.3, borderWidth: 2 },
                        { label: 'Floor (<=200)', data: floorBandData, borderColor: '#64748b', backgroundColor: '#64748b', tension: 0.3, borderWidth: 2 }
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
                if (data.eligibility.full_bonus) eligContainer.innerHTML = `<div class="single-badge full"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"></polyline></svg> Full Bonus Qualified</div>`;
                else if (data.eligibility.collection_bonus_45) eligContainer.innerHTML = `<div class="single-badge partial"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"></polyline></svg> 45% Collection Bonus Qualified</div>`;
                else eligContainer.innerHTML = `<div class="single-badge missed"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg> Bonus Missed</div>`;
            }

            setElText('res-total-payout', formatKES(salary + data.current.base_bonus + data.collection.upside));
            setElText('res-basic-salary', formatKES(salary));
            setElText('res-bonus-earned', formatKES(data.current.base_bonus));
            setElText('res-founders-bonus', formatKES(data.collection.upside));
            
            const currentRange = formatRange(data.current.min, data.current.max);
            setElText('res-current-band-full', `${currentRange} (${data.current.band})`);
            
            if (data.eligibility.collection_bonus_45) {
                setElText('res-multiplier', `${(data.current.multiplier * 100).toFixed(0)}%`);
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

            const currentMetrics = {
                disbursement: getVal('disbursement'), active_customers: getVal('active_customers'),
                new_customers: getVal('new_customers'), otc: getVal('otc'),
                dd7: getVal('dd7'), new_customer_otc: getVal('new_customer_otc')
            };

            const updateRowUI = (key, diffId, statusId) => {
                const diff = currentMetrics[key] - TARGETS[key];
                const diffEl = document.getElementById(diffId);
                if (diffEl) {
                    diffEl.textContent = `${diff > 0 ? '+' : ''}${diff.toFixed(1)}%`;
                    diffEl.className = `diff-val ${diff >= 0 ? 'positive' : 'negative'}`;
                }
                const statusEl = document.getElementById(statusId);
                if (statusEl) {
                    statusEl.innerHTML = currentMetrics[key] >= TARGETS[key] 
                        ? `<span class="status-badge met">✓ Met</span>` 
                        : `<span class="status-badge missed">✕ Not Met</span>`;
                }
            };

            ['disbursement','active_customers','new_customers','otc','dd7','new_customer_otc'].forEach((k, i) => {
                updateRowUI(k, ['diff-disbursement','diff-active-customers','diff-new-customers','diff-otc','diff-dd7','diff-new-cust-otc'][i], ['status-disbursement','status-active-customers','status-new-customers','status-otc','status-dd7','status-new-cust-otc'][i]);
            });

            const selectedMonth = document.getElementById('month-filter')?.value;
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
                setElText('fig-otc-val', `${(p.overall_otc || 0).toFixed(1)}%`);
                setElText('fig-dd7-val', `${(p.dd7_rate || 0).toFixed(1)}%`);
                setElText('fig-new-otc-val', `${currentMetrics.new_customer_otc.toFixed(1)}%`);
            } else {
                ['fig-disb-actual','fig-disb-target','fig-ac-actual','fig-ac-target','fig-nc-actual','fig-nc-target'].forEach(id => setElText(id, id.includes('disb') ? 'KSh 0' : '0'));
                ['fig-otc-val','fig-dd7-val','fig-new-otc-val'].forEach(id => setElText(id, '0.0%'));
            }

            const payload = {
                employee_name: viewedUser.name, employee_id: viewedUser.id, employee_type: viewedUser.type, pairs: viewedUser.pairs,
                salary: getVal('salary'), customers: parseInt(document.getElementById('customers')?.value) || 0, disb_actual: disbActualVal,
                disbursement: currentMetrics.disbursement / 100, active_customers: currentMetrics.active_customers / 100,
                new_customers: currentMetrics.new_customers / 100, otc: currentMetrics.otc / 100, dd7: currentMetrics.dd7 / 100, new_customer_otc: currentMetrics.new_customer_otc / 100
            };

            try {
                const res = await fetch('/api/calculate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
                const data = await res.json();
                if (data.success) renderDashboardData(data, payload.salary);
            } catch (err) { console.error("Calculation Error:", err); }
        };

        const applyMonthPerformance = () => {
            if (!viewedUser || !viewedUser.performance) return;
            const selectedMonth = document.getElementById('month-filter')?.value;
            const p = viewedUser.performance[selectedMonth];

            if (p) {
                const getRate = (a, t, rate) => (t > 0 && !isNaN(a) && !isNaN(t)) ? ((a / t) * 100).toFixed(1) : (rate ? (parseFloat(String(rate).replace('%','')) <= 1 ? (parseFloat(rate)*100).toFixed(1) : parseFloat(rate).toFixed(1)) : "0.0");
                const parseRate = (v) => (!v) ? "0.0" : (parseFloat(String(v).replace('%','')) <= 1 ? (parseFloat(v)*100).toFixed(1) : parseFloat(v).toFixed(1));

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

            // Inject the user's Profile Picture into the top right navigation
            const avatarContainer = document.getElementById('top-user-avatar');
            if (avatarContainer && user.picture) {
                avatarContainer.innerHTML = `<img src="${user.picture}" alt="Profile" style="width: 100%; height: 100%; object-fit: cover; border-radius: 50%;">`;
                avatarContainer.style.background = 'transparent';
                avatarContainer.style.border = 'none';
                avatarContainer.style.padding = '0';
            }

            // Inject the user's Profile Picture into the Centralized Modal
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
            setElText('emp-info-role', user.type);
            setElText('emp-info-pairs', user.pairs);
            
            if (document.getElementById('salary')) document.getElementById('salary').value = '';
            setupMonthFilter();
            applyMonthPerformance();
        };

        const computePerformanceForUser = (user, perfData) => {
            if (!user || !perfData) return;
            const branch = (user.branch || '').toLowerCase().trim();
            const type = (user.type || '').toUpperCase();
            const isBM = type.includes('BM') || type.includes('MANAGER');
            user.performance = {};

            if (isBM) {
                const prefix = `${branch}_`;
                const agg = {};
                for (const [key, metrics] of Object.entries(perfData || {})) {
                    if (key.toLowerCase().startsWith(prefix)) {
                        const parts = key.split('_');
                        const monthCode = parts[parts.length - 1];
                        if (!agg[monthCode]) agg[monthCode] = { count: 0, disb_actual: 0, disb_target: 0, disb_rate: 0, ac_actual: 0, ac_target: 0, ac_rate: 0, nc_actual: 0, nc_target: 0, nc_rate: 0, overall_otc: 0, dd7_rate: 0, new_customer_otc: 0 };
                        
                        const m = agg[monthCode];
                        m.count++;
                        m.disb_actual += metrics.disb_actual || 0; m.disb_target += metrics.disb_target || 0; m.disb_rate += metrics.disb_rate || 0;
                        m.ac_actual += metrics.ac_actual || 0; m.ac_target += metrics.ac_target || 0; m.ac_rate += metrics.ac_rate || 0;
                        m.nc_actual += metrics.nc_actual || 0; m.nc_target += metrics.nc_target || 0; m.nc_rate += metrics.nc_rate || 0;
                        m.overall_otc += metrics.overall_otc || 0; m.dd7_rate += metrics.dd7_rate || 0; m.new_customer_otc += metrics.new_customer_otc || 0;
                    }
                }
                for (const [mCode, data] of Object.entries(agg)) {
                    if (data.count > 0) {
                        user.performance[mCode] = {
                            disb_actual: data.disb_actual, disb_target: data.disb_target, disb_rate: data.disb_rate / data.count,
                            ac_actual: data.ac_actual, ac_target: data.ac_target, ac_rate: data.ac_rate / data.count,
                            nc_actual: data.nc_actual, nc_target: data.nc_target, nc_rate: data.nc_rate / data.count,
                            overall_otc: data.overall_otc / data.count, dd7_rate: data.dd7_rate / data.count, new_customer_otc: data.new_customer_otc / data.count
                        };
                    }
                }
            } else {
                let rawPair = String(user.pairs || '1').toLowerCase().trim();
                if (rawPair === '1' || rawPair === '') rawPair = 'pair 1';
                else if (rawPair === '2') rawPair = 'pair 2';
                else if (rawPair === '3') rawPair = 'pair 3';
                
                const prefix = `${branch}_${rawPair}_`;
                for (const [key, metrics] of Object.entries(perfData || {})) {
                    if (key.toLowerCase().startsWith(prefix)) {
                        const parts = key.split('_');
                        const monthCode = parts[parts.length - 1];
                        user.performance[monthCode] = metrics;
                    }
                }
            }
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
            item.addEventListener('click', () => handleNavigation(item.getAttribute('data-view')));
        });

        document.querySelectorAll('.metric-row').forEach(row => {
            row.addEventListener('click', (e) => {
                if (e.target.tagName === 'INPUT') return;
                const metricKey = row.getAttribute('data-metric');
                const detailsRow = document.getElementById(`details-${metricKey}`);
                row.classList.toggle('expanded');
                if (detailsRow) detailsRow.classList.toggle('show');
            });
        });

        const modalOverlay = document.getElementById('mobile-profile-modal');
        document.getElementById('top-user-avatar')?.addEventListener('click', () => { if (modalOverlay) modalOverlay.classList.add('active'); });
        document.getElementById('close-profile-modal')?.addEventListener('click', () => { if (modalOverlay) modalOverlay.classList.remove('active'); });
        modalOverlay?.addEventListener('click', (e) => { if (e.target === modalOverlay) modalOverlay.classList.remove('active'); });

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

        document.getElementById('btn-calculate')?.addEventListener('click', (e) => { e.preventDefault(); runCalculation(); });
        document.getElementById('salary')?.addEventListener('input', runCalculation);
        document.getElementById('calculator-form')?.addEventListener('submit', (e) => { e.preventDefault(); runCalculation(); });

        // --- Safe User Initialization ---
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
                        fetch('/api/auth/google', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ credential: token })
                        })
                        .then(res => res.json())
                        .then(data => {
                            if (data && data.success) {
                                if (data.all_staff) {
                                    allStaffData = data.all_staff;
                                    filteredStaff = allStaffData;
                                }
                                if (data.raw_performance) rawPerformance = data.raw_performance;
                                
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

document.getElementById('btn-logout-drawer')?.addEventListener('click', () => { sessionStorage.clear(); window.location.href = '/'; });

function renderGoogleButton() {
    const container = document.getElementById('g_id_signin_container');
    if (!container || typeof google === 'undefined' || !google.accounts) return;

    const currentTheme = document.documentElement.getAttribute('data-theme') || 'light';
    container.innerHTML = '';
    
    // Adjusted styling and shape to match the personalized rectangular button
    google.accounts.id.renderButton(container, { 
        type: "standard", 
        shape: "rectangular", 
        theme: currentTheme === 'dark' ? "filled_black" : "outline", 
        text: "continue_with", 
        size: "large", 
        logo_alignment: "left" 
    });
    
    // Automatically trigger One Tap if a session exists
    google.accounts.id.prompt();
}

window.addEventListener('load', () => setTimeout(renderGoogleButton, 300));
document.getElementById('theme-toggle-btn')?.addEventListener('click', () => setTimeout(renderGoogleButton, 50));