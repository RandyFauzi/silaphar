/**
 * APLIKASI WEB REKAPITULASI PELAPORAN WBP KALSEL
 * Integrasi Database Penyimpanan Spreadsheet (SQLite + LocalStorage) + Google Apps Script + PDF 16:9
 */

const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbyC7Rb0oI6rOJBRoeK_xWtFmbiRLlv2PSsOSvk8i_4kPe79tjh9R5kDp3p1H4HI2iqG/exec";
const DEFAULT_SPREADSHEET_ID = "1-0rXQqvGqFzgyl48EbLe7Kfbi6Wz1YZ_sDmWoEOLTtw";
const DEFAULT_SPREADSHEET_NAME = "Rekapitulasi WBP Oktober 2026 (Default)";

// State
let rawSheetData = null;
let currentReportDate = "";
let selectedSheet = "";
let currentSpreadsheetId = localStorage.getItem("amak_active_ss_id") || DEFAULT_SPREADSHEET_ID;
let registeredSpreadsheets = [];

// DOM Elements
const loadingModal = document.getElementById("loadingModal");
const loadingText = document.getElementById("loadingText");
const statusBadge = document.getElementById("statusBadge");
const selectDbSpreadsheet = document.getElementById("selectDbSpreadsheet");
const selectSheet = document.getElementById("selectSheet");
const syncCacheBadge = document.getElementById("syncCacheBadge");
const inputReportDate = document.getElementById("inputReportDate");
const chkAutoDate = document.getElementById("chkAutoDate");
const btnSetToday = document.getElementById("btnSetToday");
const coverDateDisplay = document.getElementById("coverDateDisplay");

// Modal Elements
const modalSpreadsheet = document.getElementById("modalSpreadsheet");
const btnOpenSsModal = document.getElementById("btnOpenSsModal");
const btnCloseSsModal = document.getElementById("btnCloseSsModal");
const btnCancelSsModal = document.getElementById("btnCancelSsModal");
const btnApplySs = document.getElementById("btnApplySs");
const btnResetDefaultSs = document.getElementById("btnResetDefaultSs");
const inputSsUrl = document.getElementById("inputSsUrl");
const inputSsLabel = document.getElementById("inputSsLabel");
const chkSetDefault = document.getElementById("chkSetDefault");
const docCardsList = document.getElementById("docCardsList");
const dbItemCount = document.getElementById("dbItemCount");

// =============================================================================
// DATABASE SERVICE (Hybrid SQLite Backend via api.php & LocalStorage Client-Side)
// =============================================================================
const dbService = {
  isBackendAvailable: false,

  async init() {
    try {
      const resp = await fetch("api.php?action=list");
      if (resp.ok) {
        const json = await resp.json();
        if (json.status === "success" && Array.isArray(json.data)) {
          this.isBackendAvailable = true;
          return json.data;
        }
      }
    } catch (e) {
      // api.php tidak tersedia (misal berjalan pada file:///), gunakan LocalStorage
    }
    this.isBackendAvailable = false;
    return this.getLocalList();
  },

  getLocalList() {
    try {
      const raw = localStorage.getItem("amak_db_spreadsheets");
      if (raw) {
        return JSON.parse(raw);
      }
    } catch (e) {}
    // Inisialisasi default jika belum ada
    const initialList = [{
      id: DEFAULT_SPREADSHEET_ID,
      name: DEFAULT_SPREADSHEET_NAME,
      url: `https://docs.google.com/spreadsheets/d/${DEFAULT_SPREADSHEET_ID}/edit`,
      last_synced: "-",
      cached_data: null,
      is_default: 1,
      created_at: new Date().toISOString()
    }];
    this.saveLocalList(initialList);
    return initialList;
  },

  saveLocalList(list) {
    localStorage.setItem("amak_db_spreadsheets", JSON.stringify(list));
  },

  async getSpreadsheet(id) {
    if (this.isBackendAvailable) {
      try {
        const resp = await fetch(`api.php?action=get&id=${encodeURIComponent(id)}`);
        if (resp.ok) {
          const json = await resp.json();
          if (json.status === "success") return json;
        }
      } catch (e) {}
    }
    const list = this.getLocalList();
    return list.find((item) => item.id === id) || null;
  },

  async saveSpreadsheet(item) {
    if (this.isBackendAvailable) {
      try {
        await fetch("api.php?action=save", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(item)
        });
      } catch (e) {}
    }

    // Selalu simpan juga di local storage sebagai mirror
    const list = this.getLocalList();
    const idx = list.findIndex((x) => x.id === item.id);
    if (idx >= 0) {
      list[idx] = { ...list[idx], ...item };
    } else {
      list.push(item);
    }
    this.saveLocalList(list);
  },

  async deleteSpreadsheet(id) {
    if (this.isBackendAvailable) {
      try {
        await fetch("api.php?action=delete", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id })
        });
      } catch (e) {}
    }
    let list = this.getLocalList();
    list = list.filter((item) => item.id !== id);
    this.saveLocalList(list);
  }
};

// =============================================================================
// INITIALIZATION
// =============================================================================
document.addEventListener("DOMContentLoaded", async () => {
  setupEventListeners();
  setupSpreadsheetModalListeners();
  setupPdfModalListeners();
  setupMobileResponsiveScaler();
  
  // Pasang tanggal hari ini secara default di input & cover
  const todayStr = getIndonesianDate(new Date());
  setReportDate(todayStr);

  // Inisialisasi Database
  await initDatabase();
  
  // Muat data spreadsheet aktif (dari cache lokal lalu otomatis update real-time dari Google Sheets)
  await loadActiveSpreadsheetData();

  // Aktifkan sinkronisasi otomatis latar belakang setiap 60 detik (real-time updates)
  startRealtimeAutoRefresh();
});

async function initDatabase() {
  registeredSpreadsheets = await dbService.init();
  updateDatabaseSelector();
}

function updateDatabaseSelector() {
  if (!selectDbSpreadsheet) return;
  selectDbSpreadsheet.innerHTML = "";

  registeredSpreadsheets.forEach((item) => {
    const opt = document.createElement("option");
    opt.value = item.id;
    opt.textContent = `${item.is_default ? "[Default] " : ""}${item.name}`;
    if (item.id === currentSpreadsheetId) {
      opt.selected = true;
    }
    selectDbSpreadsheet.appendChild(opt);
  });

  // Opsi Tambah Baru
  const optAdd = document.createElement("option");
  optAdd.value = "__ADD_NEW__";
  optAdd.textContent = "+ Daftarkan Spreadsheet Baru...";
  selectDbSpreadsheet.appendChild(optAdd);
}

// =============================================================================
// EVENT LISTENERS
// =============================================================================
function setupEventListeners() {
  document.getElementById("btnRefresh").addEventListener("click", () => {
    fetchDataFromAppsScript(true, selectedSheet, true);
  });

  if (selectDbSpreadsheet) {
    selectDbSpreadsheet.addEventListener("change", async (e) => {
      const val = e.target.value;
      if (val === "__ADD_NEW__") {
        openSpreadsheetModal("tabAdd");
        selectDbSpreadsheet.value = currentSpreadsheetId;
        return;
      }
      currentSpreadsheetId = val;
      localStorage.setItem("amak_active_ss_id", val);
      selectedSheet = "";
      loadActiveSpreadsheetData();
    });
  }

  if (selectSheet) {
    selectSheet.addEventListener("change", (e) => {
      selectedSheet = e.target.value;
      fetchDataFromAppsScript(false, selectedSheet, false);
    });
  }

  const btnSavePdf = document.getElementById("btnSavePdf");
  if (btnSavePdf) {
    btnSavePdf.addEventListener("click", () => {
      openPdfDownloadModal();
    });
  }

  // Kompatibilitas tombol lama
  const btnDownloadPdf = document.getElementById("btnDownloadPdf");
  if (btnDownloadPdf) {
    btnDownloadPdf.addEventListener("click", openPdfDownloadModal);
  }
  const btnPrintPdf = document.getElementById("btnPrintPdf");
  if (btnPrintPdf) {
    btnPrintPdf.addEventListener("click", openPdfDownloadModal);
  }

  if (chkAutoDate) {
    chkAutoDate.addEventListener("change", (e) => {
      if (e.target.checked && rawSheetData) {
        applySheetDate(rawSheetData);
      }
    });
  }

  if (btnSetToday) {
    btnSetToday.addEventListener("click", () => {
      if (chkAutoDate) chkAutoDate.checked = true;
      selectedSheet = "";
      if (selectSheet) selectSheet.value = "";
      const todayStr = getIndonesianDate(new Date());
      setReportDate(todayStr);
      fetchDataFromAppsScript(true, "", true, false);
    });
  }

  inputReportDate.addEventListener("input", (e) => {
    currentReportDate = e.target.value;
    coverDateDisplay.innerText = currentReportDate;
    if (chkAutoDate) {
      chkAutoDate.checked = false;
    }
  });

  // Tab navigation
  const tabBtns = document.querySelectorAll(".nav-tab-item, .tab-btn");
  tabBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      tabBtns.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      const targetSlideId = btn.getAttribute("data-slide");
      const targetElement = document.getElementById(targetSlideId);
      if (targetElement) {
        targetElement.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    });
  });
}

/**
 * Event Listeners Modal Database Spreadsheet
 */
/**
 * Setup Event Listeners untuk Modal Database Spreadsheet
 */
function setupSpreadsheetModalListeners() {
  if (btnOpenSsModal) {
    btnOpenSsModal.addEventListener("click", () => openSpreadsheetModal("tabList"));
  }
  if (btnCloseSsModal) {
    btnCloseSsModal.addEventListener("click", closeSpreadsheetModal);
  }
  if (btnCancelSsModal) {
    btnCancelSsModal.addEventListener("click", closeSpreadsheetModal);
  }

  if (modalSpreadsheet) {
    modalSpreadsheet.addEventListener("click", (e) => {
      if (e.target === modalSpreadsheet) closeSpreadsheetModal();
    });
  }

  // Segmented Tabs Navigasi Modal
  const modalTabBtns = document.querySelectorAll(".modal-tab-btn");
  modalTabBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      const targetTab = btn.getAttribute("data-tab");
      switchModalTab(targetTab);
    });
  });

  const btnGoToAddTab = document.getElementById("btnGoToAddTab");
  if (btnGoToAddTab) {
    btnGoToAddTab.addEventListener("click", () => {
      switchModalTab("tabAdd");
    });
  }

  if (btnResetDefaultSs) {
    btnResetDefaultSs.addEventListener("click", async () => {
      currentSpreadsheetId = DEFAULT_SPREADSHEET_ID;
      localStorage.setItem("amak_active_ss_id", DEFAULT_SPREADSHEET_ID);
      selectedSheet = "";
      updateDatabaseSelector();
      closeSpreadsheetModal();
      loadActiveSpreadsheetData();
    });
  }

  // Daftarkan Spreadsheet Baru & Langsung Copy Data Snapshot
  if (btnApplySs) {
    btnApplySs.addEventListener("click", async () => {
      const inputVal = inputSsUrl.value.trim();
      if (!inputVal) {
        alert("Silakan masukkan URL atau ID Google Spreadsheet terlebih dahulu.");
        return;
      }

      const extractedId = extractSpreadsheetId(inputVal);
      if (!extractedId || extractedId.length < 15) {
        alert("Format Link atau ID Google Spreadsheet tidak dikenali. Pastikan Anda menyalin link lengkap atau ID spreadsheet.");
        return;
      }

      const labelVal = inputSsLabel.value.trim() || `Spreadsheet (${extractedId.substring(0, 8)}...)`;
      const isDefault = chkSetDefault && chkSetDefault.checked ? 1 : 0;

      showLoader("Mendaftarkan & menyalin data snapshot dari Google Sheets ke database...");

      try {
        // Ambil data live pertama kali untuk dicopy ke database
        const url = `${APPS_SCRIPT_URL}?spreadsheetId=${encodeURIComponent(extractedId)}&t=${Date.now()}`;
        const response = await fetch(url);
        const data = await response.json();

        if (data.status === "error") {
          throw new Error(data.message || "Gagal membaca Google Sheets.");
        }

        // Simpan ke database lokal
        const newRecord = {
          id: extractedId,
          name: labelVal,
          url: `https://docs.google.com/spreadsheets/d/${extractedId}/edit`,
          last_synced: formatTimestampNow(),
          cached_data: data,
          is_default: isDefault,
          created_at: new Date().toISOString()
        };

        await dbService.saveSpreadsheet(newRecord);
        registeredSpreadsheets = await dbService.init();

        currentSpreadsheetId = extractedId;
        localStorage.setItem("amak_active_ss_id", extractedId);
        selectedSheet = "";

        updateDatabaseSelector();
        await renderDbTable();
        switchModalTab("tabList");
        closeSpreadsheetModal();

        // Terapkan data ke tampilan
        applyLoadedData(data, labelVal, newRecord.last_synced);
        alert(`Berhasil! Spreadsheet '${labelVal}' telah didaftarkan dan seluruh data snapshot telah tersimpan di database lokal.`);
      } catch (err) {
        console.error("Gagal mendaftarkan:", err);
        alert(`Gagal mendaftarkan spreadsheet: ${err.message}\nPastikan dokumen dapat diakses oleh akun Google Anda.`);
      } finally {
        hideLoader();
      }
    });
  }
}

function switchModalTab(tabId) {
  document.querySelectorAll(".modal-tab-btn").forEach((b) => {
    b.classList.toggle("active", b.getAttribute("data-tab") === tabId);
  });
  document.querySelectorAll(".modal-tab-pane").forEach((p) => {
    p.classList.toggle("active", p.id === tabId);
  });
}

function openSpreadsheetModal(defaultTab = "tabList") {
  if (!modalSpreadsheet) return;
  inputSsUrl.value = "";
  inputSsLabel.value = "";
  if (chkSetDefault) chkSetDefault.checked = false;
  switchModalTab(defaultTab);
  renderDbTable();
  modalSpreadsheet.classList.add("active");
}

function closeSpreadsheetModal() {
  if (modalSpreadsheet) {
    modalSpreadsheet.classList.remove("active");
  }
}

/**
 * Render Daftar Dokumen Berbentuk Card Modern di dalam Modal
 */
async function renderDbTable() {
  const container = document.getElementById("docCardsList");
  if (!container) return;
  container.innerHTML = "";

  registeredSpreadsheets = await dbService.init();
  if (dbItemCount) {
    dbItemCount.textContent = registeredSpreadsheets.length;
  }

  if (registeredSpreadsheets.length === 0) {
    container.innerHTML = `
      <div style="text-align: center; padding: 28px 16px; color: #64748b;">
        <p style="font-size: 0.88rem; font-weight: 700; color: #1e293b;">Belum ada spreadsheet terdaftar</p>
        <p style="font-size: 0.76rem; margin-top: 4px;">Daftarkan spreadsheet pertama Anda untuk memulai.</p>
        <button type="button" class="btn-submit-modern" onclick="switchModalTab('tabAdd')" style="margin: 12px auto 0; font-size: 0.76rem; padding: 6px 14px; width: auto;">
          + Daftarkan Sekarang
        </button>
      </div>
    `;
    return;
  }

  registeredSpreadsheets.forEach((item) => {
    const isCurrent = item.id === currentSpreadsheetId;
    const card = document.createElement("div");
    card.className = `doc-card-item ${isCurrent ? "is-active" : ""}`;

    const shortId = item.id.length > 20 ? `${item.id.substring(0, 10)}...${item.id.slice(-6)}` : item.id;
    const sheetUrl = item.url || `https://docs.google.com/spreadsheets/d/${item.id}/edit`;
    const lastSyncText = item.last_synced ? item.last_synced : "Belum pernah disinkronkan";

    card.innerHTML = `
      <div class="doc-card-left">
        <div class="doc-card-details">
          <div class="doc-card-title-row">
            <span class="doc-card-name" title="${item.name}">${item.name}</span>
            ${item.is_default ? '<span class="badge-tag badge-tag-default">Default</span>' : ''}
            ${isCurrent ? '<span class="badge-tag badge-tag-active">Aktif</span>' : ''}
          </div>
          <div class="doc-card-submeta">
            <span>ID: <code title="${item.id}">${shortId}</code></span>
            <span>•</span>
            <span>Salinan: ${lastSyncText}</span>
            <span>•</span>
            <a href="${sheetUrl}" target="_blank" rel="noopener noreferrer" class="meta-link" title="Buka Spreadsheet di Tab Baru">
              Buka Sheets
            </a>
          </div>
        </div>
      </div>
      <div class="doc-card-actions">
        ${isCurrent ? `
          <button type="button" class="btn-card-active-pill" disabled title="Dokumen ini sedang aktif digunakan di tampilan">
            Sedang Aktif
          </button>
        ` : `
          <button type="button" class="btn-card-use btn-db-open" data-id="${item.id}" title="Gunakan spreadsheet ini di dashboard">
            Gunakan
          </button>
        `}
        <button type="button" class="btn-card-action-text btn-db-sync" data-id="${item.id}" title="Sinkronkan ulang data dari Google Sheets">
          Sinkron
        </button>
        ${!item.is_default && !isCurrent ? `
          <button type="button" class="btn-card-action-text danger btn-db-del" data-id="${item.id}" title="Hapus dari database lokal">
            Hapus
          </button>
        ` : ''}
      </div>
    `;

    container.appendChild(card);
  });

  // Tombol aksi buka / gunakan
  container.querySelectorAll(".btn-db-open").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.getAttribute("data-id");
      currentSpreadsheetId = id;
      localStorage.setItem("amak_active_ss_id", id);
      selectedSheet = "";
      updateDatabaseSelector();
      closeSpreadsheetModal();
      loadActiveSpreadsheetData();
    });
  });

  // Tombol sinkron ulang
  container.querySelectorAll(".btn-db-sync").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.getAttribute("data-id");
      showLoader("Menyinkronkan ulang data dari Google Sheets...");
      try {
        const url = `${APPS_SCRIPT_URL}?spreadsheetId=${encodeURIComponent(id)}&t=${Date.now()}`;
        const response = await fetch(url);
        const data = await response.json();
        if (data.status === "error") throw new Error(data.message);

        const target = registeredSpreadsheets.find((x) => x.id === id);
        if (target) {
          target.cached_data = data;
          target.last_synced = formatTimestampNow();
          await dbService.saveSpreadsheet(target);
          if (id === currentSpreadsheetId) {
            applyLoadedData(data, target.name, target.last_synced);
          }
        }
        await renderDbTable();
        alert("Sinkronisasi ulang berhasil! Seluruh data snapshot terbaru telah tersimpan di database lokal.");
      } catch (err) {
        alert("Gagal sinkronisasi: " + err.message);
      } finally {
        hideLoader();
      }
    });
  });

  // Tombol hapus dokumen
  container.querySelectorAll(".btn-db-del").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.getAttribute("data-id");
      const target = registeredSpreadsheets.find((x) => x.id === id);
      const name = target ? target.name : id;
      if (confirm(`Apakah Anda yakin ingin menghapus '${name}' dari database?`)) {
        await dbService.deleteSpreadsheet(id);
        registeredSpreadsheets = await dbService.init();
        if (currentSpreadsheetId === id) {
          currentSpreadsheetId = DEFAULT_SPREADSHEET_ID;
          localStorage.setItem("amak_active_ss_id", DEFAULT_SPREADSHEET_ID);
          loadActiveSpreadsheetData();
        }
        updateDatabaseSelector();
        await renderDbTable();
      }
    });
  });
}

// =============================================================================
// DATA LOADING & CACHE RESOLUTION
// =============================================================================
async function loadActiveSpreadsheetData() {
  // Cek apakah data snapshot sudah ada di database lokal untuk rendering instan (0ms)
  const record = await dbService.getSpreadsheet(currentSpreadsheetId);
  const recordName = record ? record.name : "Spreadsheet Aktif";

  let hasCached = false;
  if (record && record.cached_data && record.cached_data.rows && !selectedSheet) {
    applyLoadedData(record.cached_data, recordName, record.last_synced);
    hasCached = true;
    statusBadge.className = "status-dot-pill loading";
    statusBadge.innerHTML = `<span class="dot"></span> Memperbarui data real-time...`;
    if (syncCacheBadge) {
      const syncTimeStr = record.last_synced ? (record.last_synced.includes(' ') ? record.last_synced.split(' ')[1] : record.last_synced) : 'Lokal';
      syncCacheBadge.innerText = `Database (${syncTimeStr})`;
    }
  }

  // SELALU fetch data live terbaru secara real-time dari Google Spreadsheet!
  // Jika sudah ada cache, fetch di latar belakang (isSilent = true) agar tidak memunculkan popup loading
  await fetchDataFromAppsScript(false, selectedSheet, true, hasCached);
}

/**
 * Fetch data dari Google Apps Script API & Simpan ke Cache Database
 * @param {boolean} isManualRefresh - Apakah dipicu oleh tombol refresh / paksa t=Date.now()
 * @param {string} sheetParam - Nama tab sheet tertentu jika dipilih
 * @param {boolean} updateDatabaseCache - Simpan snapshot ke SQLite/LocalStorage
 * @param {boolean} isSilent - Jika true, tidak memunculkan modal overlay spinner
 */
async function fetchDataFromAppsScript(isManualRefresh = false, sheetParam = "", updateDatabaseCache = false, isSilent = false) {
  if (!isSilent) {
    showLoader("Mengambil data real-time dari Google Spreadsheet...");
  }
  statusBadge.className = "status-dot-pill loading";
  statusBadge.innerHTML = `<span class="dot"></span> Menyinkronkan...`;

  try {
    let url = APPS_SCRIPT_URL;
    const params = [];
    if (currentSpreadsheetId) {
      params.push(`spreadsheetId=${encodeURIComponent(currentSpreadsheetId)}`);
    }
    if (sheetParam) {
      params.push(`sheet=${encodeURIComponent(sheetParam)}`);
    }
    // Selalu sertakan t agar cache browser / proxy selalu terlewati dan data 100% real-time
    params.push(`t=${Date.now()}`);

    if (params.length > 0) {
      url += (url.includes("?") ? "&" : "?") + params.join("&");
    }

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP Error: ${response.status}`);
    }

    const data = await response.json();
    if (data.status === "error") {
      throw new Error(data.message || "Gagal memproses spreadsheet.");
    }
    if (!data.rows) {
      throw new Error("Format respon data tidak valid.");
    }

    rawSheetData = data;

    // Simpan ke cache database lokal jika merupakan sheet utama
    const nowSync = formatTimestampNow();
    if (updateDatabaseCache && !sheetParam) {
      const existing = await dbService.getSpreadsheet(currentSpreadsheetId);
      const docName = existing ? existing.name : (data.spreadsheet_name || "Spreadsheet");
      await dbService.saveSpreadsheet({
        id: currentSpreadsheetId,
        name: docName,
        url: `https://docs.google.com/spreadsheets/d/${currentSpreadsheetId}/edit`,
        last_synced: nowSync,
        cached_data: data,
        is_default: currentSpreadsheetId === DEFAULT_SPREADSHEET_ID ? 1 : 0,
        created_at: existing ? existing.created_at : new Date().toISOString()
      });
    }

    const currentDoc = registeredSpreadsheets.find((x) => x.id === currentSpreadsheetId);
    const docTitle = currentDoc ? currentDoc.name : (data.spreadsheet_name || "Aktif");
    applyLoadedData(data, docTitle, nowSync);

    const sheetLabel = data.current_sheet ? data.current_sheet : (data.periode || "Live");
    statusBadge.className = "status-dot-pill";
    statusBadge.innerHTML = `<span class="dot"></span> Terhubung (${sheetLabel})`;
  } catch (err) {
    console.error("Gagal mengambil data:", err);
    if (!isSilent) {
      statusBadge.className = "status-dot-pill error";
      statusBadge.innerHTML = `<span class="dot"></span> Terputus`;
      alert(`Gagal mengambil data dari Google Apps Script: ${err.message}\nPastikan dokumen dapat diakses.`);
    }
  } finally {
    if (!isSilent) {
      hideLoader();
    }
  }
}

// =============================================================================
// REAL-TIME AUTO-UPDATE (Background Polling setiap 60 detik)
// =============================================================================
let autoRefreshTimer = null;

function startRealtimeAutoRefresh() {
  if (autoRefreshTimer) clearInterval(autoRefreshTimer);
  
  // Refresh otomatis setiap 60 detik (1 menit)
  autoRefreshTimer = setInterval(async () => {
    // Hanya auto-sync jika pengguna sedang di mode otomatis (tidak sedang memilih tab sheet masa lalu secara manual)
    if (!selectedSheet) {
      await fetchDataFromAppsScript(false, "", true, true);
    }
  }, 60000);
}

/**
 * Terapkan data yang dimuat ke semua slide & tabel
 */
function applyLoadedData(data, docTitle, syncTime) {
  rawSheetData = data;

  if (syncCacheBadge) {
    const timeOnly = syncTime ? (syncTime.includes(' ') ? syncTime.split(' ')[1] : syncTime) : 'Baru Saja';
    syncCacheBadge.innerText = `Tersinkron (${timeOnly})`;
  }

  // Update Dropdown List Sheets jika tersedia
  if (data.available_sheets && selectSheet) {
    updateSheetDropdown(data.available_sheets, data.current_sheet);
  }

  // Set tanggal otomatis sesuai tanggal sheet
  if (!chkAutoDate || chkAutoDate.checked) {
    applySheetDate(data);
  }

  // Render semua 6 tabel
  renderAllTables(data.rows);
}

/**
 * Update opsi dropdown sheet tab
 */
function updateSheetDropdown(availableSheets, currentSheet) {
  if (!selectSheet) return;
  selectSheet.innerHTML = '<option value="">(Otomatis: Sheet Terbaru)</option>';
  
  availableSheets.forEach((sheetName) => {
    const opt = document.createElement("option");
    opt.value = sheetName;
    opt.textContent = sheetName;
    if (sheetName === currentSheet && selectedSheet === sheetName) {
      opt.selected = true;
    }
    selectSheet.appendChild(opt);
  });

  if (selectedSheet) {
    selectSheet.value = selectedSheet;
  }
}

// =============================================================================
// HELPER FUNCTIONS & FORMATTING
// =============================================================================
function extractSpreadsheetId(input) {
  if (!input) return "";
  const trimmed = input.trim();
  const match = trimmed.match(/(?:d\/|^)([a-zA-Z0-9-_]{20,})/);
  return match ? match[1] : trimmed;
}

function formatTimestampNow() {
  const d = new Date();
  return `${d.toLocaleDateString("id-ID")} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')} WIB`;
}

function getIndonesianDate(date = new Date()) {
  const hariList = ["MINGGU", "SENIN", "SELASA", "RABU", "KAMIS", "JUM’AT", "SABTU"];
  const bulanList = [
    "JANUARI", "FEBRUARI", "MARET", "APRIL", "MEI", "JUNI",
    "JULI", "AGUSTUS", "SEPTEMBER", "OKTOBER", "NOVEMBER", "DESEMBER"
  ];
  
  const hari = hariList[date.getDay()];
  const tgl = date.getDate();
  const bulan = bulanList[date.getMonth()];
  const tahun = date.getFullYear();
  
  return `${hari}, ${tgl} ${bulan} ${tahun}`;
}

function setReportDate(dateStr) {
  currentReportDate = dateStr;
  if (inputReportDate) inputReportDate.value = dateStr;
  if (coverDateDisplay) coverDateDisplay.innerText = dateStr;
}

function applySheetDate(data) {
  if (data && data.tanggal_tampil) {
    setReportDate(data.tanggal_tampil);
  } else {
    setReportDate(getIndonesianDate(new Date()));
  }
}

function formatNumber(val) {
  if (val === "" || val === null || val === undefined) return "0";
  const num = Number(val);
  return isNaN(num) ? val : num.toLocaleString("id-ID");
}

function formatPercent(val) {
  if (val === "" || val === null || val === undefined) return "0%";
  if (typeof val === "string" && val.includes("%")) return val;
  const num = parseFloat(val);
  if (isNaN(num)) return "0%";
  const pct = Math.round(num * 100);
  return `${pct}%`;
}

function isOverCapacity(val) {
  if (typeof val === "string" && val.includes("%")) {
    const n = parseFloat(val);
    return n > 0;
  }
  const n = parseFloat(val);
  return !isNaN(n) && n > 0;
}

// =============================================================================
// TABLE RENDERING (6 TEMATIK SLIDES)
// =============================================================================
function renderAllTables(rows) {
  const dataRows = [];
  let summaryRow = null;

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (!r || r.length < 2) continue;

    const col0Str = String(r[0]).trim().toUpperCase();
    const col1Str = String(r[1]).trim();

    // 1. Cek baris total JUMLAH
    if (col0Str === "JUMLAH" || col0Str.includes("JUMLAH") || col1Str.toUpperCase().includes("JUMLAH")) {
      summaryRow = r;
      continue;
    }

    // 2. FILTER: Lewati baris penomoran kolom (1, 2, 3...)
    if (!isNaN(Number(col1Str)) || !/[a-zA-Z]/.test(col1Str)) {
      continue;
    }

    // 3. Masukkan baris data UPT yang valid
    if (r[0] !== "" && !isNaN(parseInt(r[0]))) {
      dataRows.push(r);
    }
  }

  if (!summaryRow && rows.length > 0) {
    const lastRow = rows[rows.length - 1];
    if (String(lastRow[0]).toUpperCase().includes("JUMLAH") || isNaN(parseInt(lastRow[0]))) {
      summaryRow = lastRow;
    }
  }

  renderTable1(dataRows, summaryRow);
  renderTable2(dataRows, summaryRow);
  renderTable3(dataRows, summaryRow);
  renderTable4(dataRows, summaryRow);
  renderTable5(dataRows, summaryRow);
  renderTable6(dataRows, summaryRow);
}

function renderTable1(dataRows, summaryRow) {
  const tbody = document.getElementById("tbody-table1");
  if (!tbody) return;
  tbody.innerHTML = "";

  dataRows.forEach((r) => {
    const overVal = r[6];
    const isOver = isOverCapacity(overVal);
    const overClass = isOver ? "bg-red" : "bg-lime";

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${r[0]}</td>
      <td class="col-upt">${r[1]}</td>
      <td>${formatNumber(r[2])}</td>
      <td>${formatNumber(r[3])}</td>
      <td class="bg-lime">${formatNumber(r[4])}</td>
      <td class="bg-lime">${formatNumber(r[5])}</td>
      <td class="${overClass}">${formatPercent(overVal)}</td>
      <td>${formatNumber(r[7])}</td>
      <td>${formatNumber(r[8])}</td>
      <td>${formatNumber(r[9])}</td>
      <td>${formatNumber(r[10])}</td>
      <td>${formatNumber(r[11])}</td>
      <td>${formatNumber(r[12])}</td>
      <td>${formatNumber(r[13])}</td>
    `;
    tbody.appendChild(tr);
  });

  if (summaryRow) {
    const tr = document.createElement("tr");
    tr.className = "row-jumlah";
    tr.innerHTML = `
      <td class="col-label" colspan="2">JUMLAH</td>
      <td>${formatNumber(summaryRow[2])}</td>
      <td>${formatNumber(summaryRow[3])}</td>
      <td>${formatNumber(summaryRow[4])}</td>
      <td>${formatNumber(summaryRow[5])}</td>
      <td>${formatPercent(summaryRow[6])}</td>
      <td>${formatNumber(summaryRow[7])}</td>
      <td>${formatNumber(summaryRow[8])}</td>
      <td>${formatNumber(summaryRow[9])}</td>
      <td>${formatNumber(summaryRow[10])}</td>
      <td>${formatNumber(summaryRow[11])}</td>
      <td>${formatNumber(summaryRow[12])}</td>
      <td>${formatNumber(summaryRow[13])}</td>
    `;
    tbody.appendChild(tr);
  }
}

function renderTable2(dataRows, summaryRow) {
  const tbody = document.getElementById("tbody-table2");
  if (!tbody) return;
  tbody.innerHTML = "";

  dataRows.forEach((r) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${r[0]}</td>
      <td class="col-upt">${r[1]}</td>
      <td>${formatNumber(r[14])}</td>
      <td>${formatNumber(r[15])}</td>
      <td>${formatNumber(r[16])}</td>
      <td>${formatNumber(r[17])}</td>
      <td>${formatNumber(r[18])}</td>
      <td>${formatNumber(r[19])}</td>
      <td>${formatNumber(r[20])}</td>
    `;
    tbody.appendChild(tr);
  });

  if (summaryRow) {
    const tr = document.createElement("tr");
    tr.className = "row-jumlah";
    tr.innerHTML = `
      <td class="col-label" colspan="2">JUMLAH</td>
      <td>${formatNumber(summaryRow[14])}</td>
      <td>${formatNumber(summaryRow[15])}</td>
      <td>${formatNumber(summaryRow[16])}</td>
      <td>${formatNumber(summaryRow[17])}</td>
      <td>${formatNumber(summaryRow[18])}</td>
      <td>${formatNumber(summaryRow[19])}</td>
      <td>${formatNumber(summaryRow[20])}</td>
    `;
    tbody.appendChild(tr);
  }
}

function renderTable3(dataRows, summaryRow) {
  const tbody = document.getElementById("tbody-table3");
  if (!tbody) return;
  tbody.innerHTML = "";

  dataRows.forEach((r) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${r[0]}</td>
      <td class="col-upt">${r[1]}</td>
      <td>${formatNumber(r[21])}</td>
      <td>${formatNumber(r[22])}</td>
      <td>${formatNumber(r[23])}</td>
      <td>${formatNumber(r[24])}</td>
      <td>${formatNumber(r[25])}</td>
      <td>${formatNumber(r[26])}</td>
      <td class="bg-lime">${formatNumber(r[27])}</td>
    `;
    tbody.appendChild(tr);
  });

  if (summaryRow) {
    const tr = document.createElement("tr");
    tr.className = "row-jumlah";
    tr.innerHTML = `
      <td class="col-label" colspan="2">JUMLAH</td>
      <td>${formatNumber(summaryRow[21])}</td>
      <td>${formatNumber(summaryRow[22])}</td>
      <td>${formatNumber(summaryRow[23])}</td>
      <td>${formatNumber(summaryRow[24])}</td>
      <td>${formatNumber(summaryRow[25])}</td>
      <td>${formatNumber(summaryRow[26])}</td>
      <td>${formatNumber(summaryRow[27])}</td>
    `;
    tbody.appendChild(tr);
  }
}

function renderTable4(dataRows, summaryRow) {
  const tbody = document.getElementById("tbody-table4");
  if (!tbody) return;
  tbody.innerHTML = "";

  dataRows.forEach((r) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${r[0]}</td>
      <td class="col-upt">${r[1]}</td>
      <td>${formatNumber(r[28])}</td>
      <td>${formatNumber(r[29])}</td>
      <td>${formatNumber(r[30])}</td>
      <td>${formatNumber(r[31])}</td>
      <td>${formatNumber(r[32])}</td>
      <td class="bg-lime">${formatNumber(r[33])}</td>
      <td class="bg-lime">${formatNumber(r[34])}</td>
      <td>${formatNumber(r[35])}</td>
      <td>${formatNumber(r[36])}</td>
    `;
    tbody.appendChild(tr);
  });

  if (summaryRow) {
    const tr = document.createElement("tr");
    tr.className = "row-jumlah";
    tr.innerHTML = `
      <td class="col-label" colspan="2">JUMLAH</td>
      <td>${formatNumber(summaryRow[28])}</td>
      <td>${formatNumber(summaryRow[29])}</td>
      <td>${formatNumber(summaryRow[30])}</td>
      <td>${formatNumber(summaryRow[31])}</td>
      <td>${formatNumber(summaryRow[32])}</td>
      <td>${formatNumber(summaryRow[33])}</td>
      <td>${formatNumber(summaryRow[34])}</td>
      <td>${formatNumber(summaryRow[35])}</td>
      <td>${formatNumber(summaryRow[36])}</td>
    `;
    tbody.appendChild(tr);
  }
}

function renderTable5(dataRows, summaryRow) {
  const tbody = document.getElementById("tbody-table5");
  if (!tbody) return;
  tbody.innerHTML = "";

  dataRows.forEach((r) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${r[0]}</td>
      <td class="col-upt">${r[1]}</td>
      <td>${formatNumber(r[37])}</td>
      <td>${formatNumber(r[38])}</td>
      <td>${formatNumber(r[39])}</td>
      <td>${formatNumber(r[40])}</td>
      <td>${formatNumber(r[41])}</td>
      <td>${formatNumber(r[42])}</td>
      <td>${formatNumber(r[43])}</td>
      <td class="bg-lime">${formatNumber(r[44])}</td>
    `;
    tbody.appendChild(tr);
  });

  if (summaryRow) {
    const tr = document.createElement("tr");
    tr.className = "row-jumlah";
    tr.innerHTML = `
      <td class="col-label" colspan="2">JUMLAH</td>
      <td>${formatNumber(summaryRow[37])}</td>
      <td>${formatNumber(summaryRow[38])}</td>
      <td>${formatNumber(summaryRow[39])}</td>
      <td>${formatNumber(summaryRow[40])}</td>
      <td>${formatNumber(summaryRow[41])}</td>
      <td>${formatNumber(summaryRow[42])}</td>
      <td>${formatNumber(summaryRow[43])}</td>
      <td>${formatNumber(summaryRow[44])}</td>
    `;
    tbody.appendChild(tr);
  }
}

function renderTable6(dataRows, summaryRow) {
  const tbody = document.getElementById("tbody-table6");
  if (!tbody) return;
  tbody.innerHTML = "";

  dataRows.forEach((r) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${r[0]}</td>
      <td class="col-upt">${r[1]}</td>
      <td>${formatNumber(r[45])}</td>
      <td>${formatNumber(r[46])}</td>
      <td class="bg-lime">${formatNumber(r[47])}</td>
      <td>${formatNumber(r[48])}</td>
      <td>${formatNumber(r[49])}</td>
      <td class="bg-lime">${formatNumber(r[50])}</td>
    `;
    tbody.appendChild(tr);
  });

  if (summaryRow) {
    const tr = document.createElement("tr");
    tr.className = "row-jumlah";
    tr.innerHTML = `
      <td class="col-label" colspan="2">JUMLAH</td>
      <td>${formatNumber(summaryRow[45])}</td>
      <td>${formatNumber(summaryRow[46])}</td>
      <td>${formatNumber(summaryRow[47])}</td>
      <td>${formatNumber(summaryRow[48])}</td>
      <td>${formatNumber(summaryRow[49])}</td>
      <td>${formatNumber(summaryRow[50])}</td>
    `;
    tbody.appendChild(tr);
  }
}

// =============================================================================
// PDF GENERATION & EXPORT (DIRECT DOWNLOAD FOR MOBILE/DESKTOP & BROWSER PRINT)
// =============================================================================
function openPdfDownloadModal() {
  if (chkAutoDate && chkAutoDate.checked && rawSheetData) {
    applySheetDate(rawSheetData);
  }
  
  const modal = document.getElementById("modalPdfDownload");
  const modalDate = document.getElementById("pdfModalDate");
  const progressBox = document.getElementById("pdfProgressBox");
  const btnDirect = document.getElementById("btnDirectDownloadPdf");
  const btnPrint = document.getElementById("btnBrowserPrintPdf");

  if (modalDate && coverDateDisplay) {
    modalDate.innerText = coverDateDisplay.innerText.trim() || "Hari Ini";
  }
  if (progressBox) progressBox.classList.add("hidden");
  if (btnDirect) btnDirect.disabled = false;
  if (btnPrint) btnPrint.disabled = false;
  if (modal) modal.classList.remove("hidden");
  document.body.classList.add("modal-open");
}

function openSavePdfDialog() {
  openPdfDownloadModal();
}

function closePdfModal() {
  const modal = document.getElementById("modalPdfDownload");
  if (modal) modal.classList.add("hidden");
  document.body.classList.remove("modal-open");
}

function triggerBrowserPrint() {
  closePdfModal();
  setTimeout(() => {
    window.print();
  }, 200);
}

function preparePdfExportContainer() {
  const container = document.createElement("div");
  container.id = "pdfExportStaging";
  container.className = "pdf-export-container";

  for (let i = 1; i <= 8; i++) {
    const originalSlide = document.getElementById("slide-" + i);
    if (!originalSlide) continue;

    const clonedSlide = originalSlide.cloneNode(true);
    clonedSlide.removeAttribute("id");

    // Hapus tombol zoom atau elemen khusus layar
    const unwanted = clonedSlide.querySelectorAll(".btn-slide-zoom, .no-print");
    unwanted.forEach((el) => el.remove());

    // Berikan styling inline pasti 1440x810 agar tidak terpengaruh responsive scaling HP
    clonedSlide.style.width = "1440px";
    clonedSlide.style.height = "810px";
    clonedSlide.style.minWidth = "1440px";
    clonedSlide.style.minHeight = "810px";
    clonedSlide.style.maxWidth = "1440px";
    clonedSlide.style.maxHeight = "810px";
    clonedSlide.style.transform = "none";
    clonedSlide.style.margin = "0";
    clonedSlide.style.boxSizing = "border-box";
    clonedSlide.style.boxShadow = "none";
    clonedSlide.style.borderRadius = "0";
    clonedSlide.style.overflow = "hidden";
    clonedSlide.style.display = "flex";
    clonedSlide.style.flexDirection = "column";

    if (i === 1) {
      clonedSlide.style.backgroundImage = "url('assets/cover_template.png')";
      clonedSlide.style.backgroundSize = "cover";
      clonedSlide.style.backgroundPosition = "center";
      clonedSlide.style.padding = "0";
    } else if (i === 8) {
      clonedSlide.style.backgroundImage = "url('assets/closing.png')";
      clonedSlide.style.backgroundSize = "cover";
      clonedSlide.style.backgroundPosition = "center";
      clonedSlide.style.padding = "0";
    } else {
      clonedSlide.style.backgroundImage = "url('assets/table_bg.jpg')";
      clonedSlide.style.backgroundSize = "cover";
      clonedSlide.style.backgroundPosition = "center";
      clonedSlide.style.padding = "38px 46px";
    }

    container.appendChild(clonedSlide);
  }

  return container;
}

async function generateAndDownloadPdf() {
  if (typeof html2pdf === "undefined") {
    alert("Library pemroses PDF sedang dimuat. Mengalihkan ke menu cetak browser...");
    triggerBrowserPrint();
    return;
  }

  const btnDirect = document.getElementById("btnDirectDownloadPdf");
  const btnPrint = document.getElementById("btnBrowserPrintPdf");
  const progressBox = document.getElementById("pdfProgressBox");
  const progressBar = document.getElementById("pdfProgressBar");
  const progressLabel = document.getElementById("pdfProgressLabel");
  const progressPercent = document.getElementById("pdfProgressPercent");

  const updateProgress = (pct, text) => {
    if (progressBar) progressBar.style.width = pct + "%";
    if (progressPercent) progressPercent.innerText = pct + "%";
    if (progressLabel) progressLabel.innerText = text;
  };

  try {
    if (btnDirect) btnDirect.disabled = true;
    if (btnPrint) btnPrint.disabled = true;
    if (progressBox) progressBox.classList.remove("hidden");

    updateProgress(15, "Menyiapkan lembar rekapitulasi data 1440x810...");

    // Pastikan tanggal terbaru diaplikasikan
    if (chkAutoDate && chkAutoDate.checked && rawSheetData) {
      applySheetDate(rawSheetData);
    }

    // Buat nama file resmi berdasarkan tanggal
    let dateStr = "";
    if (coverDateDisplay && coverDateDisplay.innerText) {
      dateStr = coverDateDisplay.innerText.trim().replace(/\s+/g, "_").replace(/[^a-zA-Z0-9_]/g, "");
    }
    const filename = `SILAPHAR_Rekap_WBP_${dateStr || "Terbaru"}.pdf`;

    updateProgress(35, "Menyusun 8 halaman slide lanskap...");
    const staging = preparePdfExportContainer();
    document.body.appendChild(staging);

    updateProgress(55, "Merender dokumen ke format PDF resolusi tinggi...");

    const opt = {
      margin: 0,
      filename: filename,
      image: { type: "jpeg", quality: 0.98 },
      html2canvas: {
        scale: 1, // Resolusi 1:1 HD 1440x810, tajam, zero pixel drift, aman di memori HP
        useCORS: true,
        scrollY: 0,
        scrollX: 0,
        logging: false,
        windowWidth: 1440
      },
      jsPDF: {
        unit: "px",
        format: [1440, 810],
        orientation: "landscape",
        hotfixes: ["px_scaling"]
      }
    };

    updateProgress(75, "Menyimpan file PDF ke perangkat Anda...");
    await html2pdf().from(staging).set(opt).save();

    // Bersihkan staging container dari DOM
    if (staging && staging.parentNode) {
      staging.parentNode.removeChild(staging);
    }

    updateProgress(100, "Berhasil! File PDF telah diunduh.");

    setTimeout(() => {
      if (progressBox) progressBox.classList.add("hidden");
      if (btnDirect) btnDirect.disabled = false;
      if (btnPrint) btnPrint.disabled = false;
      closePdfModal();
    }, 1200);

  } catch (err) {
    console.error("Gagal membuat PDF langsung:", err);
    updateProgress(100, "Gagal membuat PDF otomatis. Mengalihkan ke menu cetak...");
    
    const staging = document.getElementById("pdfExportStaging");
    if (staging && staging.parentNode) staging.parentNode.removeChild(staging);

    setTimeout(() => {
      if (progressBox) progressBox.classList.add("hidden");
      if (btnDirect) btnDirect.disabled = false;
      if (btnPrint) btnPrint.disabled = false;
      closePdfModal();
      window.print();
    }, 1500);
  }
}

function setupPdfModalListeners() {
  const btnClosePdf = document.getElementById("btnClosePdfModal");
  if (btnClosePdf) {
    btnClosePdf.addEventListener("click", closePdfModal);
  }
  const btnCancelPdf = document.getElementById("btnCancelPdfModal");
  if (btnCancelPdf) {
    btnCancelPdf.addEventListener("click", closePdfModal);
  }
  const backdropPdf = document.getElementById("backdropPdfModal");
  if (backdropPdf) {
    backdropPdf.addEventListener("click", closePdfModal);
  }
  const btnDirectDownload = document.getElementById("btnDirectDownloadPdf");
  if (btnDirectDownload) {
    btnDirectDownload.addEventListener("click", generateAndDownloadPdf);
  }
  const btnBrowserPrint = document.getElementById("btnBrowserPrintPdf");
  if (btnBrowserPrint) {
    btnBrowserPrint.addEventListener("click", triggerBrowserPrint);
  }
}

function showLoader(msg) {
  if (loadingModal) {
    loadingText.innerText = msg;
    loadingModal.classList.remove("hidden");
  }
}

function hideLoader() {
  if (loadingModal) {
    loadingModal.classList.add("hidden");
  }
}

// =============================================================================
// MOBILE RESPONSIVE 16:9 SCALER & HIGH-RES ZOOM MODAL (BEST PRACTICE)
// =============================================================================
let currentZoomSlideIndex = 1;
const TOTAL_SLIDES = 8;

function setupMobileResponsiveScaler() {
  function updateSlideScale() {
    const scaler = document.querySelector(".slide-viewport-scaler");
    if (scaler) {
      const width = scaler.clientWidth;
      if (width > 0 && width < 1400) {
        const scale = width / 1440;
        const height = width * 9 / 16;
        document.documentElement.style.setProperty("--slide-scale", scale.toString());
        document.documentElement.style.setProperty("--slide-height-mobile", `${Math.round(height)}px`);
      } else {
        document.documentElement.style.setProperty("--slide-scale", "1");
        document.documentElement.style.setProperty("--slide-height-mobile", "810px");
      }
    }
  }

  // Update scale immediately and on window events
  updateSlideScale();
  window.addEventListener("resize", updateSlideScale);
  window.addEventListener("orientationchange", () => {
    setTimeout(updateSlideScale, 150);
  });

  // Klik pada tombol "Perbesar"
  document.querySelectorAll(".btn-slide-zoom").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const container = btn.closest(".slide-card-container");
      if (container) {
        const index = container.getAttribute("data-slide-index");
        if (index) openSlideZoom(index);
      }
    });
  });

  // Klik langsung pada viewport scaler di layar HP/tablet
  document.querySelectorAll(".slide-viewport-scaler").forEach((scaler) => {
    scaler.addEventListener("click", () => {
      if (window.innerWidth <= 900) {
        const container = scaler.closest(".slide-card-container");
        if (container) {
          const index = container.getAttribute("data-slide-index");
          if (index) openSlideZoom(index);
        }
      }
    });
  });

  // Modal Zoom Controls
  const modalZoom = document.getElementById("modalSlideZoom");
  const btnCloseZoom = document.getElementById("btnCloseZoomModal");
  const btnPrevZoom = document.getElementById("btnPrevZoomSlide");
  const btnNextZoom = document.getElementById("btnNextZoomSlide");

  if (btnCloseZoom) {
    btnCloseZoom.addEventListener("click", closeSlideZoom);
  }

  if (modalZoom) {
    const backdrop = modalZoom.querySelector(".slide-zoom-backdrop");
    if (backdrop) {
      backdrop.addEventListener("click", closeSlideZoom);
    }
  }

  if (btnPrevZoom) {
    btnPrevZoom.addEventListener("click", () => {
      if (currentZoomSlideIndex > 1) {
        openSlideZoom(currentZoomSlideIndex - 1);
      }
    });
  }

  if (btnNextZoom) {
    btnNextZoom.addEventListener("click", () => {
      if (currentZoomSlideIndex < TOTAL_SLIDES) {
        openSlideZoom(currentZoomSlideIndex + 1);
      }
    });
  }

  // Keyboard navigation
  document.addEventListener("keydown", (e) => {
    if (modalZoom && !modalZoom.classList.contains("hidden")) {
      if (e.key === "Escape") closeSlideZoom();
      if (e.key === "ArrowLeft" && currentZoomSlideIndex > 1) openSlideZoom(currentZoomSlideIndex - 1);
      if (e.key === "ArrowRight" && currentZoomSlideIndex < TOTAL_SLIDES) openSlideZoom(currentZoomSlideIndex + 1);
    }
  });
}

function openSlideZoom(slideIndex) {
  currentZoomSlideIndex = parseInt(slideIndex, 10) || 1;
  const slideElem = document.getElementById(`slide-${currentZoomSlideIndex}`);
  const container = document.querySelector(`[data-slide-index="${currentZoomSlideIndex}"]`);
  const modal = document.getElementById("modalSlideZoom");
  const modalContent = document.getElementById("slideZoomContent");
  const modalTitle = document.getElementById("zoomSlideTitle");
  const modalCounter = document.getElementById("zoomSlideCounter");
  const btnPrev = document.getElementById("btnPrevZoomSlide");
  const btnNext = document.getElementById("btnNextZoomSlide");

  if (!slideElem || !modal || !modalContent) return;

  // Judul Slide
  let title = `Slide ${currentZoomSlideIndex} dari ${TOTAL_SLIDES}`;
  if (container) {
    const badge = container.querySelector(".slide-badge-label");
    if (badge) title = badge.innerText;
  }
  if (modalTitle) modalTitle.innerText = title;
  if (modalCounter) modalCounter.innerText = `${currentZoomSlideIndex} / ${TOTAL_SLIDES}`;

  // Update tombol nav status
  if (btnPrev) btnPrev.disabled = currentZoomSlideIndex <= 1;
  if (btnNext) btnNext.disabled = currentZoomSlideIndex >= TOTAL_SLIDES;

  // Clone slide content agar style dan live data asli tampil sempurna
  modalContent.innerHTML = "";
  const clone = slideElem.cloneNode(true);
  clone.id = `zoom-clone-slide-${currentZoomSlideIndex}`;
  modalContent.appendChild(clone);

  modal.classList.remove("hidden");
  document.body.classList.add("modal-open");

  // Reset scroll position ke kiri atas
  const zoomBody = document.getElementById("slideZoomBody");
  if (zoomBody) {
    zoomBody.scrollLeft = 0;
    zoomBody.scrollTop = 0;
  }
}

function closeSlideZoom() {
  const modal = document.getElementById("modalSlideZoom");
  if (modal) {
    modal.classList.add("hidden");
    document.body.classList.remove("modal-open");
  }
  const modalContent = document.getElementById("slideZoomContent");
  if (modalContent) {
    modalContent.innerHTML = "";
  }
}
