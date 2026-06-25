// ==UserScript==
// @name         Avito Seller Blocker
// @namespace    http://tampermonkey.net/
// @version      2.4
// @description  Block unwanted sellers on Avito with single-button approach
// @match        *://www.avito.ru/*
// @grant        GM_addStyle
// ==/UserScript==

(function() {
    'use strict';

    const PRODUCT_CARD_SELECTOR = 'div[itemtype="http://schema.org/Product"]';
    const SELLER_LINK_SELECTOR = 'a[href*="/brands/"][href*="search_seller_info"]';
    const BRAND_CODE_REGEX = /\/brands\/([a-z0-9]+)\?/;
    const STORAGE_KEY = 'avito_blocked_sellers_v2';
    const BUTTON_SIZE = 30;
    const BUTTON_OFFSET = 8;

    // ==================== STORAGE ====================
    function getBlockedSellers() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (!raw) return [];
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed) && parsed.length > 0 && typeof parsed[0] === 'string') {
                return parsed.map(code => ({ code, name: 'Unknown', blockedAt: Date.now() }));
            }
            return parsed;
        } catch (e) { return []; }
    }
    function saveBlockedSellers(list) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
    }
    function addBlockedSeller(code, name) {
        const list = getBlockedSellers();
        const existing = list.find(s => s.code === code);
        if (existing) {
            if (name && name !== 'Unknown') existing.name = name;
        } else {
            list.push({ code, name: name || 'Unknown', blockedAt: Date.now() });
        }
        saveBlockedSellers(list);
    }
    function removeBlockedSeller(code) {
        saveBlockedSellers(getBlockedSellers().filter(s => s.code !== code));
    }

    const tempShownSellers = new Set();

    // ==================== STYLES ====================
    GM_addStyle(`
        .sb-close-btn {
            position: fixed;
            width: ${BUTTON_SIZE}px;
            height: ${BUTTON_SIZE}px;
            background: rgba(220, 53, 69, 0.95);
            color: #fff;
            border: 2px solid #fff;
            border-radius: 50%;
            font-size: 16px;
            font-weight: bold;
            line-height: ${BUTTON_SIZE - 4}px;
            text-align: center;
            cursor: pointer;
            z-index: 2147483647;
            opacity: 0;
            pointer-events: none;
            transition: opacity 0.15s, transform 0.15s, background 0.15s;
            padding: 0;
            font-family: Arial, sans-serif;
            box-shadow: 0 2px 8px rgba(0,0,0,0.4);
        }
        .sb-close-btn.sb-visible {
            opacity: 1;
            pointer-events: auto;
        }
        .sb-close-btn:hover {
            background: #a71d2a;
            transform: scale(1.15);
        }

        .sb-temp-shown {
            outline: 2px dashed #ffc107 !important;
            outline-offset: -2px;
        }

        #sb-toggle {
            position: fixed;
            bottom: 20px;
            right: 20px;
            width: 50px;
            height: 50px;
            background: #dc3545;
            color: #fff;
            border: none;
            border-radius: 50%;
            font-size: 22px;
            cursor: pointer;
            z-index: 2147483647;
            box-shadow: 0 3px 12px rgba(0,0,0,0.35);
            display: flex;
            align-items: center;
            justify-content: center;
        }
        #sb-toggle:hover { background: #b52a37; }
        #sb-badge {
            position: absolute;
            top: -5px;
            right: -5px;
            background: #ffc107;
            color: #000;
            border-radius: 50%;
            min-width: 22px;
            height: 22px;
            font-size: 12px;
            font-weight: bold;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 0 4px;
            border: 2px solid #fff;
        }

        #sb-modal {
            display: none;
            position: fixed;
            inset: 0;
            background: rgba(0,0,0,0.55);
            z-index: 2147483647;
            justify-content: center;
            align-items: center;
        }
        #sb-modal.active { display: flex; }
        #sb-modal-content {
            background: #fff;
            border-radius: 10px;
            width: 560px;
            max-width: 92vw;
            max-height: 82vh;
            display: flex;
            flex-direction: column;
            box-shadow: 0 8px 30px rgba(0,0,0,0.35);
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif;
            overflow: hidden;
        }
        #sb-modal-header {
            padding: 16px 20px;
            border-bottom: 1px solid #eee;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        #sb-modal-header h3 { margin: 0; font-size: 18px; }
        #sb-modal-close {
            background: none; border: none; font-size: 26px;
            cursor: pointer; color: #888; line-height: 1;
        }
        #sb-search {
            margin: 12px 20px 0;
            padding: 8px 12px;
            border: 1px solid #ddd;
            border-radius: 6px;
            font-size: 14px;
            width: calc(100% - 40px);
            box-sizing: border-box;
        }
        #sb-search:focus { outline: none; border-color: #dc3545; }
        #sb-modal-body { padding: 8px 20px 20px; overflow-y: auto; flex: 1; }
        .sb-empty { color: #999; text-align: center; padding: 40px 20px; font-style: italic; }
        .sb-item {
            display: flex; align-items: center; padding: 10px 0;
            border-bottom: 1px solid #f0f0f0; gap: 10px;
        }
        .sb-item:last-child { border-bottom: none; }
        .sb-info { flex: 1; min-width: 0; }
        .sb-name {
            font-weight: 600; font-size: 14px; color: #222;
            white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        }
        .sb-code {
            font-family: monospace; font-size: 11px; color: #999; margin-top: 2px;
            white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        }
        .sb-badges { display: flex; gap: 4px; flex-shrink: 0; }
        .sb-badge {
            font-size: 10px; padding: 2px 7px; border-radius: 10px;
            white-space: nowrap; font-weight: 600;
        }
        .sb-badge-page { background: #28a745; color: #fff; }
        .sb-badge-temp { background: #ffc107; color: #000; }
        .sb-actions { display: flex; gap: 6px; flex-shrink: 0; }
        .sb-btn {
            padding: 5px 10px; border: none; border-radius: 5px;
            cursor: pointer; font-size: 12px; font-weight: 500; white-space: nowrap;
        }
        .sb-btn:disabled { opacity: 0.4; cursor: not-allowed; }
        .sb-btn-show { background: #17a2b8; color: #fff; }
        .sb-btn-hide { background: #6c757d; color: #fff; }
        .sb-btn-unblock { background: #dc3545; color: #fff; }
        #sb-footer {
            padding: 12px 20px; border-top: 1px solid #eee;
            display: flex; justify-content: space-between; align-items: center;
            font-size: 12px; color: #888;
        }
        #sb-clear-all {
            background: none; border: none; color: #dc3545;
            cursor: pointer; font-size: 12px; text-decoration: underline;
        }
    `);

    // ==================== CORE ====================
    function getBrandCodeFromCard(card) {
        const link = card.querySelector(SELLER_LINK_SELECTOR);
        if (!link) return null;
        const match = (link.getAttribute('href') || '').match(BRAND_CODE_REGEX);
        return match ? match[1] : null;
    }

    function getSellerNameFromCard(card) {
        const link = card.querySelector(SELLER_LINK_SELECTOR);
        if (!link) return null;
        const p = link.querySelector('p');
        if (p) {
            const name = p.textContent.trim();
            if (name) return name;
        }
        const img = link.querySelector('img');
        return (img && img.alt) ? img.alt : null;
    }

    // Registry: card element -> { brandCode, sellerName }
    const cardRegistry = new WeakMap();

    // Single global button
    const globalButton = document.createElement('button');
    globalButton.className = 'sb-close-btn';
    globalButton.textContent = '✕';
    document.body.appendChild(globalButton);

    let currentHoveredCard = null;

    function positionButtonForCard(card) {
        const rect = card.getBoundingClientRect();
        // Hide if card is outside viewport
        if (rect.bottom < 0 || rect.top > window.innerHeight ||
            rect.right < 0 || rect.left > window.innerWidth) {
            globalButton.classList.remove('sb-visible');
            return false;
        }
        globalButton.style.top = (rect.top + BUTTON_OFFSET) + 'px';
        globalButton.style.left = (rect.right - BUTTON_OFFSET - BUTTON_SIZE) + 'px';
        return true;
    }

    function processCard(card) {
        if (cardRegistry.has(card)) return;

        const brandCode = getBrandCodeFromCard(card);
        console.log(brandCode);
        if (!brandCode) return;
        card.dataset.sbBrandCode = brandCode;

        const sellerName = getSellerNameFromCard(card);
        if (sellerName) {
            const list = getBlockedSellers();
            const existing = list.find(s => s.code === brandCode);
            if (existing && existing.name === 'Unknown') {
                existing.name = sellerName;
                saveBlockedSellers(list);
            }
        }

        cardRegistry.set(card, { brandCode, sellerName });
        applyVisibility(card, brandCode);
    }

    // Event delegation: handle hover on any card
    document.body.addEventListener('mouseover', (e) => {
        const card = e.target.closest(PRODUCT_CARD_SELECTOR);
        if (card && card !== currentHoveredCard) {
            const entry = cardRegistry.get(card);
            if (entry) {
                currentHoveredCard = card;
                if (positionButtonForCard(card)) {
                    globalButton.classList.add('sb-visible');
                    globalButton.title = `Block seller${entry.sellerName ? ': ' + entry.sellerName : ''}`;
                    globalButton.onclick = (ev) => {
                        ev.preventDefault();
                        ev.stopPropagation();
                        if (confirm(`Block this seller${entry.sellerName ? ' "' + entry.sellerName + '"' : ''}?`)) {
                            blockSeller(entry.brandCode, entry.sellerName);
                        }
                    };
                }
            }
        }
    });

    document.body.addEventListener('mouseout', (e) => {
        const card = e.target.closest(PRODUCT_CARD_SELECTOR);
        if (card && !card.contains(e.relatedTarget)) {
            if (card === currentHoveredCard) {
                currentHoveredCard = null;
                globalButton.classList.remove('sb-visible');
            }
        }
    });

    // Reposition button on scroll/resize
    function repositionButton() {
        if (currentHoveredCard) {
            positionButtonForCard(currentHoveredCard);
        }
    }
    window.addEventListener('scroll', repositionButton, { passive: true });
    window.addEventListener('resize', repositionButton, { passive: true });

    function processAllCards() {
        const cards = document.querySelectorAll(PRODUCT_CARD_SELECTOR);
        let processed = 0;
        cards.forEach(card => {
            if (!cardRegistry.has(card)) {
                processCard(card);
                processed++;
            }
        });
        if (processed > 0) {
            console.log(`[Seller Blocker] Processed ${processed} new cards (total: ${cards.length})`);
        }
    }

    function applyVisibility(card, brandCode) {
        const isBlocked = getBlockedSellers().some(s => s.code === brandCode);
        const isTempShown = tempShownSellers.has(brandCode);

        if (isBlocked && !isTempShown) {
            card.style.display = 'none';
            card.classList.remove('sb-temp-shown');
        } else if (isBlocked && isTempShown) {
            card.style.display = '';
            card.classList.add('sb-temp-shown');
        } else {
            card.style.display = '';
            card.classList.remove('sb-temp-shown');
        }
    }

    function blockSeller(brandCode, name) {
        addBlockedSeller(brandCode, name);
        tempShownSellers.delete(brandCode);
        refreshAllCards();
        updateBadge();
    }
    function unblockSeller(brandCode) {
        removeBlockedSeller(brandCode);
        tempShownSellers.delete(brandCode);
        refreshAllCards();
        updateBadge();
    }
    function tempShowSeller(brandCode) {
        tempShownSellers.add(brandCode);
        refreshAllCards();
        renderModal();
    }
    function tempHideSeller(brandCode) {
        tempShownSellers.delete(brandCode);
        refreshAllCards();
        renderModal();
    }
    function refreshAllCards() {
        document.querySelectorAll(PRODUCT_CARD_SELECTOR).forEach(card => {
            const code = card.dataset.sbBrandCode || getBrandCodeFromCard(card);
            if (code) applyVisibility(card, code);
        });
    }

    // ==================== PANEL ====================
    function createPanel() {
        const toggle = document.createElement('button');
        toggle.id = 'sb-toggle';
        toggle.innerHTML = '🚫';
        toggle.title = 'Manage blocked sellers';
        toggle.addEventListener('click', () => {
            renderModal();
            document.getElementById('sb-modal').classList.add('active');
        });
        const badge = document.createElement('span');
        badge.id = 'sb-badge';
        toggle.appendChild(badge);
        document.body.appendChild(toggle);

        const modal = document.createElement('div');
        modal.id = 'sb-modal';
        modal.innerHTML = `
            <div id="sb-modal-content">
                <div id="sb-modal-header">
                    <h3>Blocked Sellers</h3>
                    <button id="sb-modal-close">&times;</button>
                </div>
                <input type="text" id="sb-search" placeholder="Search by name or code...">
                <div id="sb-modal-body"></div>
                <div id="sb-footer">
                    <span id="sb-count"></span>
                    <button id="sb-clear-all">Clear all</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);

        document.getElementById('sb-modal-close').addEventListener('click', () => {
            modal.classList.remove('active');
        });
        modal.addEventListener('click', (e) => {
            if (e.target === modal) modal.classList.remove('active');
        });
        document.getElementById('sb-search').addEventListener('input', renderModal);
        document.getElementById('sb-clear-all').addEventListener('click', () => {
            if (confirm('Unblock ALL sellers?')) {
                saveBlockedSellers([]);
                tempShownSellers.clear();
                refreshAllCards();
                updateBadge();
                renderModal();
            }
        });
        updateBadge();
    }

    function updateBadge() {
        const badge = document.getElementById('sb-badge');
        const count = getBlockedSellers().length;
        if (badge) {
            badge.textContent = count;
            badge.style.display = count > 0 ? 'flex' : 'none';
        }
    }

    function getBrandsOnPage() {
        const brands = new Set();
        document.querySelectorAll(PRODUCT_CARD_SELECTOR).forEach(card => {
            const code = card.dataset.sbBrandCode || getBrandCodeFromCard(card);
            if (code) brands.add(code);
        });
        return brands;
    }

    function renderModal() {
        const body = document.getElementById('sb-modal-body');
        const countEl = document.getElementById('sb-count');
        const filter = (document.getElementById('sb-search').value || '').toLowerCase().trim();

        let blocked = getBlockedSellers();
        const onPage = getBrandsOnPage();

        blocked.sort((a, b) => {
            const aOn = onPage.has(a.code) ? 0 : 1;
            const bOn = onPage.has(b.code) ? 0 : 1;
            if (aOn !== bOn) return aOn - bOn;
            return (b.blockedAt || 0) - (a.blockedAt || 0);
        });

        const filtered = filter
            ? blocked.filter(s => s.name.toLowerCase().includes(filter) || s.code.toLowerCase().includes(filter))
            : blocked;

        countEl.textContent = `${blocked.length} blocked` + (filter ? ` (${filtered.length} shown)` : '');

        if (filtered.length === 0) {
            body.innerHTML = blocked.length === 0
                ? '<div class="sb-empty">No sellers blocked yet.<br>Hover over a product card and click <b>✕</b>.</div>'
                : '<div class="sb-empty">No sellers match your search.</div>';
            return;
        }

        body.innerHTML = '';
        filtered.forEach(seller => {
            const isOnPage = onPage.has(seller.code);
            const isTempShown = tempShownSellers.has(seller.code);

            const item = document.createElement('div');
            item.className = 'sb-item';

            const info = document.createElement('div');
            info.className = 'sb-info';
            info.innerHTML = `
                <div class="sb-name" title="${escapeHtml(seller.name)}">${escapeHtml(seller.name)}</div>
                <div class="sb-code">${seller.code}</div>
            `;
            item.appendChild(info);

            const badges = document.createElement('div');
            badges.className = 'sb-badges';
            if (isOnPage) {
                const b = document.createElement('span');
                b.className = 'sb-badge sb-badge-page';
                b.textContent = 'on page';
                badges.appendChild(b);
            }
            if (isTempShown) {
                const b = document.createElement('span');
                b.className = 'sb-badge sb-badge-temp';
                b.textContent = 'temp shown';
                badges.appendChild(b);
            }
            item.appendChild(badges);

            const actions = document.createElement('div');
            actions.className = 'sb-actions';

            if (isTempShown) {
                const b = document.createElement('button');
                b.className = 'sb-btn sb-btn-hide';
                b.textContent = 'Hide';
                b.addEventListener('click', () => tempHideSeller(seller.code));
                actions.appendChild(b);
            } else {
                const b = document.createElement('button');
                b.className = 'sb-btn sb-btn-show';
                b.textContent = 'Show';
                b.disabled = !isOnPage;
                b.addEventListener('click', () => tempShowSeller(seller.code));
                actions.appendChild(b);
            }

            const ub = document.createElement('button');
            ub.className = 'sb-btn sb-btn-unblock';
            ub.textContent = 'Unblock';
            ub.addEventListener('click', () => {
                unblockSeller(seller.code);
                renderModal();
            });
            actions.appendChild(ub);

            item.appendChild(actions);
            body.appendChild(item);
        });
    }

    function escapeHtml(s) {
        const d = document.createElement('div');
        d.textContent = s;
        return d.innerHTML;
    }

    // ==================== INIT ====================
    function init() {
        createPanel();
        processAllCards();

        const observer = new MutationObserver(() => {
            setTimeout(processAllCards, 100);
        });
        observer.observe(document.body, { childList: true, subtree: true });

        let scanInterval = setInterval(processAllCards, 1500);

        let scrollTimeout;
        window.addEventListener('scroll', () => {
            clearTimeout(scrollTimeout);
            scrollTimeout = setTimeout(processAllCards, 300);
        }, { passive: true });

        console.log('[Seller Blocker] Initialized with single-button approach');
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();