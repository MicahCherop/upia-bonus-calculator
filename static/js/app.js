(() => {
    "use strict";

    // Helper: KES Currency Formatter
    const formatKES = (num) => new Intl.NumberFormat('en-KE', { style: 'currency', currency: 'KES', maximumFractionDigits: 0 }).format(num);

    // Standard Metric Targets
    const TARGETS = {
        disbursement: 98.0,
        active_customers: 95.0,
        new_customers: 95.0,
        otc: 91.5,
        dd7: 94.0,
        new_customer_otc: 90.0
    };

    // ==========================================
    // COMMON: Theme Toggle
    // ==========================================
    const themeBtn = document.getElementById('theme-toggle-btn');
    if (themeBtn) {
        const sunSVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 20px; height: 20px;"><circle cx="12" cy="12" r="5"></circle><line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line><line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line></svg>`;
        const moonSVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 20px; height: 20px;"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg>`;

        const initialTheme = document.documentElement.getAttribute('data-theme') || 'light';
        themeBtn.innerHTML = initialTheme === 'light' ? moonSVG : sunSVG;

        themeBtn.addEventListener('click', function() {
            const currentTheme = document.documentElement.getAttribute('data-theme');
            const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
            document.documentElement.setAttribute('data-theme', newTheme);
            localStorage.setItem('theme', newTheme);
            themeBtn.innerHTML = newTheme === 'light' ? moonSVG : sunSVG;
        });
    }

    // ==========================================
    // PAGE 1: LOGIN LOGIC (index.html)
    // ==========================================
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
                if (authStatus) authStatus.style.display = 'block';
                setTimeout(() => window.location.href = '/overview', 800);
            } else {
                throw new Error(data.error || "Unauthorized access.");
            }
        } catch (err) {
            if (loginError) {
                loginError.textContent = err.message || "Authentication failed. You are not authorized.";
                loginError.style.display = 'block';
            }
        }
    };

    // ==========================================
    // PAGE 2: DASHBOARD LOGIC (overview.html)
    // ==========================================
    const appWrapper = document.getElementById('app-wrapper');
    if (appWrapper) {
        let currentUser = null;

        const setElText = (id, text) => {
            const el = document.getElementById(id);
            if (el) el.textContent = text;
        };

        const setupMonthFilter = () => {
            const selectEl = document.getElementById('month-filter');
            if (!selectEl) return;

            const monthNames = [
                "January", "February", "March", "April", "May", "June", 
                "July", "August", "September", "October", "November", "December"
            ];

            const today = new Date();
            const targetDefaultDate = new Date(today.getFullYear(), today.getMonth() - 2, 1);
            const defaultMonthCode = `${targetDefaultDate.getFullYear()}${String(targetDefaultDate.getMonth() + 1).padStart(2, '0')}`;

            const monthCodesSet = new Set();
            if (currentUser && currentUser.performance) {
                Object.keys(currentUser.performance).forEach(m => monthCodesSet.add(m));
            }

            for (let i = 0; i < 12; i++) {
                const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
                const mCode = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}`;
                monthCodesSet.add(mCode);
            }

            const sortedMonthCodes = Array.from(monthCodesSet).sort((a, b) => b.localeCompare(a));
            selectEl.innerHTML = '';

            sortedMonthCodes.forEach(mCode => {
                if (mCode.length === 6) {
                    const year = mCode.substring(0, 4);
                    const monthIdx = parseInt(mCode.substring(4, 6), 10) - 1;
                    const monthText = `${monthNames[monthIdx] || ''} ${year}`;

                    const opt = document.createElement('option');
                    opt.value = mCode;
                    opt.textContent = monthText;
                    selectEl.appendChild(opt);
                }
            });

            if (selectEl.querySelector(`option[value="${defaultMonthCode}"]`)) {
                selectEl.value = defaultMonthCode;
            } else if (selectEl.options.length > 0) {
                selectEl.selectedIndex = 0;
            }

            selectEl.addEventListener('change', () => {
                applyMonthPerformance();
            });
        };

        const applyMonthPerformance = () => {
            if (!currentUser || !currentUser.performance) return;

            const selectedMonth = document.getElementById('month-filter')?.value;
            const p = currentUser.performance[selectedMonth];

            if (p) {
                const getRate = (actual, target, directRate) => {
                    const a = parseFloat(actual);
                    const t = parseFloat(target);
                    if (t && t > 0 && !isNaN(a) && !isNaN(t)) {
                        return ((a / t) * 100).toFixed(1);
                    }
                    if (directRate !== undefined && directRate !== null) {
                        let num = typeof directRate === 'string' ? parseFloat(directRate.replace('%', '')) : parseFloat(directRate);
                        if (num > 0 && num <= 1.0) num = num * 100;
                        return isNaN(num) ? "0.0" : num.toFixed(1);
                    }
                    return "0.0";
                };

                const parseRate = (val) => {
                    if (!val && val !== 0) return "0.0";
                    let num = typeof val === 'string' ? parseFloat(val.replace('%', '')) : parseFloat(val);
                    if (num > 0 && num <= 1.0) num = num * 100;
                    return isNaN(num) ? "0.0" : num.toFixed(1);
                };

                document.getElementById('disbursement').value = getRate(p.disb_actual, p.disb_target, p.disb_rate);
                document.getElementById('active_customers').value = getRate(p.ac_actual, p.ac_target, p.ac_rate);
                document.getElementById('new_customers').value = getRate(p.nc_actual, p.nc_target, p.nc_rate);
                document.getElementById('otc').value = parseRate(p.overall_otc);
                document.getElementById('dd7').value = parseRate(p.dd7_rate);
                document.getElementById('new_customer_otc').value = parseRate(p.new_customer_otc);
                
                const custInput = document.getElementById('customers');
                if (custInput) custInput.value = parseInt(p.ac_actual) || 0;
            } else {
                document.getElementById('disbursement').value = 0;
                document.getElementById('active_customers').value = 0;
                document.getElementById('new_customers').value = 0;
                document.getElementById('otc').value = 0;
                document.getElementById('dd7').value = 0;
                document.getElementById('new_customer_otc').value = 0;
                
                const custInput = document.getElementById('customers');
                if (custInput) custInput.value = 0;
            }

            runCalculation();
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
                    currentUser = data.user;

                    setElText('top-user-name', currentUser.name);
                    setElText('top-user-role', `${currentUser.type} • ${currentUser.branch}`);
                    setElText('hero-user-firstname', currentUser.name.split(' ')[0]);

                    setElText('emp-info-name', currentUser.name);
                    setElText('emp-info-id', currentUser.id);
                    setElText('emp-info-role', currentUser.type);
                    setElText('emp-info-pairs', currentUser.pairs);

                    setElText('modal-emp-name', currentUser.name);
                    setElText('modal-emp-id', currentUser.id);
                    setElText('modal-emp-role', currentUser.type);
                    setElText('modal-emp-branch', currentUser.branch);
                    setElText('modal-emp-pairs', currentUser.pairs);
                    setElText('modal-emp-email', currentUser.email || '-');

                    const salInput = document.getElementById('salary');
                    if (salInput) salInput.value = '';

                    setupMonthFilter();
                    applyMonthPerformance();
                } else {
                    sessionStorage.clear();
                    window.location.href = '/';
                }
            })
            .catch(() => {
                sessionStorage.clear();
                window.location.href = '/';
            });
        }

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
        const avatarBtn = document.getElementById('top-user-avatar');
        const closeModalBtn = document.getElementById('close-profile-modal');

        avatarBtn?.addEventListener('click', () => {
            if (modalOverlay) modalOverlay.classList.add('active');
        });

        closeModalBtn?.addEventListener('click', () => {
            if (modalOverlay) modalOverlay.classList.remove('active');
        });

        modalOverlay?.addEventListener('click', (e) => {
            if (e.target === modalOverlay) modalOverlay.classList.remove('active');
        });

        const handleNavigation = (targetView) => {
            document.querySelectorAll('.view-panel').forEach(panel => panel.style.display = 'none');
            document.querySelectorAll('.menu-item').forEach(item => item.classList.remove('active'));
            document.querySelectorAll('.top-link').forEach(link => link.classList.remove('active'));

            const activePanel = document.getElementById(`view-${targetView}`);
            if (activePanel) activePanel.style.display = 'block';

            const sidebarItem = document.querySelector(`.menu-item[data-view="${targetView}"]`);
            if (sidebarItem) sidebarItem.classList.add('active');
        };

        document.querySelectorAll('.menu-item').forEach(item => {
            item.addEventListener('click', () => handleNavigation(item.getAttribute('data-view')));
        });

        document.getElementById('btn-logout-top')?.addEventListener('click', () => {
            sessionStorage.clear();
            window.location.href = '/';
        });

        // ==========================================
        // DYNAMIC RANGE FORMATTER (Replaces getBandRange)
        // ==========================================
        const formatRange = (min, max) => {
            if (max === null || max === undefined || max === Infinity) return `${min}+`;
            if (min === 0) return `< ${max}`;
            return `${min} - ${max}`;
        };

        const runCalculation = async () => {
            if (!currentUser) return;

            const getVal = (id) => parseFloat(document.getElementById(id)?.value) || 0;

            const currentMetrics = {
                disbursement: getVal('disbursement'),
                active_customers: getVal('active_customers'),
                new_customers: getVal('new_customers'),
                otc: getVal('otc'),
                dd7: getVal('dd7'),
                new_customer_otc: getVal('new_customer_otc')
            };

            const updateRowUI = (key, diffId, statusId) => {
                const achieved = currentMetrics[key];
                const target = TARGETS[key];
                const diff = achieved - target;

                const diffEl = document.getElementById(diffId);
                if (diffEl) {
                    const sign = diff > 0 ? '+' : '';
                    diffEl.textContent = `${sign}${diff.toFixed(1)}%`;
                    diffEl.className = `diff-val ${diff >= 0 ? 'positive' : 'negative'}`;
                }

                const statusEl = document.getElementById(statusId);
                if (statusEl) {
                    if (achieved >= target) {
                        statusEl.innerHTML = `<span class="status-badge met">✓ Met</span>`;
                    } else {
                        statusEl.innerHTML = `<span class="status-badge missed">✕ Not Met</span>`;
                    }
                }
            };

            updateRowUI('disbursement', 'diff-disbursement', 'status-disbursement');
            updateRowUI('active_customers', 'diff-active-customers', 'status-active-customers');
            updateRowUI('new_customers', 'diff-new-customers', 'status-new-customers');
            updateRowUI('otc', 'diff-otc', 'status-otc');
            updateRowUI('dd7', 'diff-dd7', 'status-dd7');
            updateRowUI('new_customer_otc', 'diff-new-cust-otc', 'status-new-cust-otc');

            const selectedMonth = document.getElementById('month-filter')?.value;
            let disbActualVal = 0; // Initialize payload disbursement actual

            if (currentUser.performance && currentUser.performance[selectedMonth]) {
                const p = currentUser.performance[selectedMonth];
                
                // Capture the exact disbursement amount required for the Founder's Bonus calculation
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
                setElText('fig-disb-actual', 'KSh 0');
                setElText('fig-disb-target', 'KSh 0');
                setElText('fig-ac-actual', '0');
                setElText('fig-ac-target', '0');
                setElText('fig-nc-actual', '0');
                setElText('fig-nc-target', '0');
                setElText('fig-otc-val', '0.0%');
                setElText('fig-dd7-val', '0.0%');
                setElText('fig-new-otc-val', '0.0%');
            }

            const payload = {
                employee_name: currentUser.name,
                employee_id: currentUser.id,
                employee_type: currentUser.type,
                pairs: currentUser.pairs,
                salary: getVal('salary'),
                customers: parseInt(document.getElementById('customers')?.value) || 0,
                disb_actual: disbActualVal, // Added disb_actual to fix the Founder's Bonus logic
                disbursement: currentMetrics.disbursement / 100,
                active_customers: currentMetrics.active_customers / 100,
                new_customers: currentMetrics.new_customers / 100,
                otc: currentMetrics.otc / 100,
                dd7: currentMetrics.dd7 / 100,
                new_customer_otc: currentMetrics.new_customer_otc / 100
            };

            try {
                const response = await fetch('/api/calculate', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
                const data = await response.json();

                if (data.success) {
                    renderDashboardData(data, payload.salary);
                }
            } catch (err) {
                console.error("Calculation Error:", err);
            }
        };

        const renderDashboardData = (data, salary) => {
            const eligContainer = document.getElementById('eligibility-container');
            if (eligContainer) {
                if (data.eligibility.full_bonus) {
                    eligContainer.innerHTML = `<div class="single-badge full"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"></polyline></svg> Full Bonus Qualified</div>`;
                } else if (data.eligibility.collection_bonus_45) {
                    eligContainer.innerHTML = `<div class="single-badge partial"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"></polyline></svg> 45% Collection Bonus Qualified</div>`;
                } else {
                    eligContainer.innerHTML = `<div class="single-badge missed"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg> Bonus Missed</div>`;
                }
            }

            const bonusEarned = data.current.base_bonus;
            const foundersBonus = data.collection.upside; 
            const totalPayout = salary + bonusEarned + foundersBonus;

            setElText('res-total-payout', formatKES(totalPayout));
            setElText('res-basic-salary', formatKES(salary));
            setElText('res-bonus-earned', formatKES(bonusEarned));
            setElText('res-founders-bonus', formatKES(foundersBonus));
            
            // Build exactly matching boundaries directly from the backend
            const currentRange = formatRange(data.current.min, data.current.max);
            setElText('res-current-band-full', `${currentRange} (${data.current.band})`);
            setElText('res-multiplier', `${data.current.multiplier.toFixed(2)}x`);

            if (data.next_band && data.next_band.band !== "None") {
                const nextRange = formatRange(data.next_band.min, data.next_band.max);
                
                setElText('hero-curr-band', `${data.current.band} (${currentRange})`);
                setElText('hero-next-band', `${data.next_band.band} (${nextRange})`);
                
                const fillBar = document.getElementById('res-prog-fill');
                if (fillBar) fillBar.style.width = `${data.next_band.progress_percent}%`;
                
                setElText('res-prog-text', `${data.current.customers} / ${data.next_band.threshold} customers total`);
                
                setElText('res-cust-needed', data.next_band.customers_needed);
                setElText('res-pot-earnings', formatKES(data.next_band.potential_bonus));
                setElText('res-growth-value', `+ ${formatKES(data.next_band.bonus_opportunity)}`);
            } else {
                setElText('hero-curr-band', `${data.current.band} (${currentRange})`);
                setElText('hero-next-band', 'Max Tier');
                
                const fillBar = document.getElementById('res-prog-fill');
                if (fillBar) fillBar.style.width = `100%`;
                
                setElText('res-prog-text', `${data.current.customers} customers (Max)`);
                setElText('res-cust-needed', '-');
                setElText('res-pot-earnings', '-');
                setElText('res-growth-value', '-');
            }
        };

        document.getElementById('btn-calculate')?.addEventListener('click', (e) => {
            e.preventDefault();
            runCalculation();
        });

        document.getElementById('salary')?.addEventListener('input', runCalculation);
        document.getElementById('calculator-form')?.addEventListener('submit', (e) => { e.preventDefault(); runCalculation(); });
    }
})();