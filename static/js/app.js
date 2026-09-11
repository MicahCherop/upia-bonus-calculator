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

    window.handleGoogleLogin = async (response) => {
        const authStatus = document.getElementById('auth-status-text');
        const loginError = document.getElementById('login-error');
        if (loginError) loginError.style.display = 'none';

        try {
            const res = await fetch('/api/auth/google', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ credential: response.credential })
            });
            const data = await res.json();

            if (data.success) {
                sessionStorage.setItem('upia_google_token', response.credential);
                sessionStorage.setItem('upia_user', JSON.stringify(data.user)); 
                if (authStatus) authStatus.style.display = 'block';
                setTimeout(() => window.location.href = '/overview', 800);
            } else {
                throw new Error(data.error || "Unauthorized access.");
            }
        } catch (err) {
            if (loginError) {
                loginError.textContent = err.message || "Authentication failed.";
                loginError.style.display = 'block';
            }
        }
    };

    const appWrapper = document.getElementById('app-wrapper');
    if (appWrapper) {
        // Separate Logged-In User from the user being viewed on the dashboard
        let loggedInUser = null;
        let viewedUser = null; 
        
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

        // PREVENT FLASHING
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
            } catch(e) {}
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

        const renderOpsAnalytics = (perfData) => {
            const ctx = document.getElementById('opsAnalyticsChart');
            if (!ctx || typeof Chart === 'undefined') return;
            new Chart(ctx, {
                type: 'line',
                data: {
                    labels: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'],
                    datasets: [
                        { label: 'Elite Band', data: [15, 18, 22, 28, 32, 45], borderColor: '#10b981', tension: 0.4 },
                        { label: 'Growth Band', data: [40, 45, 42, 50, 55, 60], borderColor: '#3b82f6', tension: 0.4 },
                        { label: 'Baseline', data: [35, 30, 25, 20, 18, 12], borderColor: '#ef4444', tension: 0.4 }
                    ]
                },
                options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom' } }, scales: { y: { beginAtZero: true } } }
            });
        };

        const setupMonthFilter = () => {
            const selectEl = document.getElementById('month-filter');
            if (!selectEl) return;

            const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
            const today = new Date();
            const targetDefaultDate = new Date(today.getFullYear(), today.getMonth() - 2, 1);
            const defaultMonthCode = `${targetDefaultDate.getFullYear()}${String(targetDefaultDate.getMonth() + 1).padStart(2, '0')}`;

            const monthCodesSet = new Set();
            if (viewedUser && viewedUser.performance) {
                Object.keys(viewedUser.performance).forEach(m => monthCodesSet.add(m));
            }
            for (let i = 0; i < 12; i++) {
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

            if (selectEl.querySelector(`option[value="${defaultMonthCode}"]`)) selectEl.value = defaultMonthCode;
            else if (selectEl.options.length > 0) selectEl.selectedIndex = 0;
            selectEl.addEventListener('change', applyMonthPerformance);
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

        // Locks the top-right nav to the original Logged-In User
        const updateProfileUI = (user) => {
            setElText('top-user-name', user.name);
            setElText('top-user-role', `${user.type} • ${user.branch}`);
            setElText('modal-emp-name', user.name);
            setElText('modal-emp-id', user.id);
            setElText('modal-emp-role', user.type);
            setElText('modal-emp-branch', user.branch);
            setElText('modal-emp-pairs', user.pairs);
            setElText('modal-emp-email', user.email || '-');
        };

        // Only updates the Dashboard area based on the user being viewed
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

        const savedToken = sessionStorage.getItem('upia_google_token');
        if (!savedToken) {
            window.location.href = '/';
        } else {
            fetch('/api/auth/google', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ credential: savedToken })
            })
            .then(res => res.json())
            .then(data => {
                if (data.success) {
                    loggedInUser = data.user;
                    viewedUser = loggedInUser;
                    sessionStorage.setItem('upia_user', JSON.stringify(loggedInUser));

                    if (data.all_staff) {
                        allStaffData = data.all_staff;
                        filteredStaff = allStaffData;
                    }
                    if (data.raw_performance) rawPerformance = data.raw_performance;

                    // Init UI
                    updateProfileUI(loggedInUser);
                    updateDashboardUI(viewedUser);

                    const userRole = (loggedInUser.type || '').toUpperCase();
                    const sidebarMenu = document.querySelector('.sidebar-menu');

                    if (loggedInUser.is_ops) {
                        const dashNav = document.getElementById('main-nav-item');
                        if (dashNav) {
                            dashNav.setAttribute('data-view', 'ops');
                            dashNav.querySelector('.menu-text').textContent = 'Overview'; 
                        }
                        
                        renderOpsStaffTable();
                        renderOpsAnalytics(rawPerformance);
                        handleNavigation('ops');
                    } else {
                        handleNavigation('dashboard');
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
                } else {
                    sessionStorage.clear();
                    window.location.href = '/';
                }
            }).catch(() => { sessionStorage.clear(); window.location.href = '/'; });
        }

        const computePerformanceForUser = (user, perfData) => {
            const branch = (user.branch || '').toLowerCase().trim();
            const type = (user.type || '').toUpperCase();
            const isBM = type.includes('BM') || type.includes('MANAGER');
            user.performance = {};

            if (isBM) {
                const prefix = `${branch}_`;
                const agg = {};
                for (const [key, metrics] of Object.entries(perfData)) {
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
                for (const [key, metrics] of Object.entries(perfData)) {
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

        document.getElementById('btn-logout-top')?.addEventListener('click', () => { sessionStorage.clear(); window.location.href = '/'; });

        const formatRange = (min, max) => {
            if (max === null || max === undefined || max === Infinity) return `${min}+`;
            if (min === 0) return `< ${max}`;
            return `${min} - ${max}`;
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
            setElText('res-multiplier', `${data.current.multiplier.toFixed(2)}x`);

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

        document.getElementById('btn-calculate')?.addEventListener('click', (e) => { e.preventDefault(); runCalculation(); });
        document.getElementById('salary')?.addEventListener('input', runCalculation);
        document.getElementById('calculator-form')?.addEventListener('submit', (e) => { e.preventDefault(); runCalculation(); });
    }
})();

document.getElementById('btn-logout-drawer')?.addEventListener('click', () => { sessionStorage.clear(); window.location.href = '/'; });

function renderGoogleButton() {
    const container = document.getElementById('g_id_signin_container');
    if (!container || typeof google === 'undefined' || !google.accounts) return;

    const currentTheme = document.documentElement.getAttribute('data-theme') || 'light';
    container.innerHTML = '';
    google.accounts.id.renderButton(container, { type: "standard", shape: "pill", theme: currentTheme === 'dark' ? "filled_black" : "outline", text: "signin_with", size: "medium", logo_alignment: "left" });
}

window.addEventListener('load', () => setTimeout(renderGoogleButton, 300));
document.getElementById('theme-toggle-btn')?.addEventListener('click', () => setTimeout(renderGoogleButton, 50));