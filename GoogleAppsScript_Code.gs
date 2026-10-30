/**
 * GOOGLE APPS SCRIPT - API REKAPITULASI PELAPORAN WBP KALSEL (VERSI MULTI-SPREADSHEET)
 * 
 * Fitur Best Practice:
 * 1. Mendukung Multi-Spreadsheet dinamis via parameter: ?spreadsheetId=ID_SPREADSHEET_BARU
 * 2. Otomatis mendeteksi dan mengambil data dari SHEET TERBARU pada spreadsheet tersebut.
 * 3. Menyesuaikan tanggal laporan pada Cover & Header secara otomatis.
 * 4. Mengembalikan daftar seluruh tab sheet yang tersedia.
 * 5. Memfilter baris penomoran 1, 2, 3... sehingga hanya mengambil 15 UPT + 1 baris JUMLAH.
 */

var DEFAULT_SPREADSHEET_ID = "1-0rXQqvGqFzgyl48EbLe7Kfbi6Wz1YZ_sDmWoEOLTtw";

function doGet(e) {
  try {
    // 1. Tentukan Spreadsheet ID yang akan dibuka
    var ssId = DEFAULT_SPREADSHEET_ID;
    if (e && e.parameter && e.parameter.spreadsheetId && e.parameter.spreadsheetId.trim() !== "") {
      ssId = e.parameter.spreadsheetId.trim();
    }

    var ss;
    try {
      ss = SpreadsheetApp.openById(ssId);
    } catch (errOpen) {
      // Jika openById gagal, coba buka active spreadsheet jika skrip terikat (container-bound)
      try {
        ss = SpreadsheetApp.getActiveSpreadsheet();
      } catch (errActive) {
        return createJsonResponse({
          status: "error",
          message: "Gagal membuka Spreadsheet ID: '" + ssId + "'. Pastikan ID/Link valid dan akun Google penyedia Apps Script memiliki akses minimal Viewer ke file tersebut."
        });
      }
    }

    if (!ss) {
      return createJsonResponse({ status: "error", message: "Dokumen spreadsheet tidak ditemukan." });
    }

    var allSheets = ss.getSheets();
    if (allSheets.length === 0) {
      return createJsonResponse({ status: "error", message: "Tidak ada sheet dalam spreadsheet ini." });
    }

    // 2. Kumpulkan seluruh sheet dan parse tanggal masing-masing
    var sheetInfos = [];
    for (var i = 0; i < allSheets.length; i++) {
      var sh = allSheets[i];
      var sName = sh.getName().trim();
      
      var parsedDate = parseDateFromSheet(sh);
      sheetInfos.push({
        sheet: sh,
        name: sName,
        index: i,
        parsedDate: parsedDate,
        timestamp: parsedDate ? parsedDate.getTime() : 0
      });
    }

    // 3. Tentukan Sheet Target
    var targetSheetInfo = null;
    var requestedSheetName = (e && e.parameter && e.parameter.sheet) ? e.parameter.sheet.trim() : null;

    // Prioritas 1: Sesuai parameter ?sheet=NamaSheet
    if (requestedSheetName) {
      for (var j = 0; j < sheetInfos.length; j++) {
        if (sheetInfos[j].name.toUpperCase() === requestedSheetName.toUpperCase()) {
          targetSheetInfo = sheetInfos[j];
          break;
        }
      }
    }

    // Prioritas 2: Cari sheet yang cocok dengan TANGGAL HARI INI
    var now = new Date();
    var todayDateOnly = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    var todayTimestamp = todayDateOnly.getTime();

    if (!targetSheetInfo) {
      for (var k = 0; k < sheetInfos.length; k++) {
        if (sheetInfos[k].parsedDate) {
          var d = sheetInfos[k].parsedDate;
          var sheetDateOnly = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
          if (sheetDateOnly === todayTimestamp) {
            targetSheetInfo = sheetInfos[k];
            break;
          }
        }
      }
    }

    // Prioritas 3: Cari sheet tanggal terbaru yang TIDAK MELEBIHI hari ini (<= hari ini)
    if (!targetSheetInfo) {
      var validPastSheets = sheetInfos.filter(function(info) {
        return info.timestamp > 0 && info.timestamp <= (todayTimestamp + 86400000 - 1);
      });

      if (validPastSheets.length > 0) {
        validPastSheets.sort(function(a, b) { return b.timestamp - a.timestamp; });
        targetSheetInfo = validPastSheets[0];
      }
    }

    // Prioritas 4: Fallback ke active sheet atau sheet pertama
    if (!targetSheetInfo) {
      var activeSheet = ss.getActiveSheet();
      if (activeSheet) {
        for (var m = 0; m < sheetInfos.length; m++) {
          if (sheetInfos[m].sheet.getSheetId() === activeSheet.getSheetId()) {
            targetSheetInfo = sheetInfos[m];
            break;
          }
        }
      }
      if (!targetSheetInfo) {
        targetSheetInfo = sheetInfos[0];
      }
    }

    var targetSheet = targetSheetInfo.sheet;
    var targetSheetName = targetSheetInfo.name;

    // 4. Format Tanggal Tampil Resmi sesuai Sheet Terpilih
    var tanggalTampil = "";
    if (targetSheetInfo.parsedDate) {
      tanggalTampil = formatTanggalIndonesia(targetSheetInfo.parsedDate);
    } else {
      tanggalTampil = formatTanggalIndonesia(now);
    }

    // Baca judul periode di Cell A2 jika ada
    var periodeText = targetSheetName;
    try {
      var cellA2 = targetSheet.getRange("A2").getValue();
      if (cellA2 && cellA2.toString().trim() !== "") {
        periodeText = cellA2.toString().trim();
      }
    } catch (err) {}

    // 5. Cari Baris Awal Data (15 UPT: dimulai tepat dari Lapas Banjarmasin)
    var searchRange = targetSheet.getRange("A5:B30").getValues();
    var startRow = 8; // Baris 8 adalah Lapas Banjarmasin
    for (var r = 0; r < searchRange.length; r++) {
      var col2 = searchRange[r][1];
      if (col2 && typeof col2 === "string" && col2.toUpperCase().indexOf("BANJARMASIN") !== -1) {
        startRow = 5 + r;
        break;
      }
    }

    // Ambil tepat 16 baris data (15 baris UPT + 1 baris JUMLAH) dan 51 kolom (A sampai AY)
    var dataRange = targetSheet.getRange(startRow, 1, 16, 51).getValues();

    // Daftar seluruh sheet untuk dropdown di web
    var availableSheetsList = sheetInfos.map(function(item) {
      return item.name;
    });

    var result = {
      status: "success",
      timestamp: now.toISOString(),
      spreadsheet_id: ss.getId(),
      spreadsheet_name: ss.getName(),
      current_sheet: targetSheetName,
      available_sheets: availableSheetsList,
      periode: periodeText,
      tanggal_tampil: tanggalTampil,
      rows: dataRange
    };

    return createJsonResponse(result);

  } catch (globalErr) {
    return createJsonResponse({
      status: "error",
      message: "Terjadi kesalahan internal: " + globalErr.toString()
    });
  }
}

/**
 * Parsing tanggal dari nama sheet atau isi Cell A1:C4
 */
function parseDateFromSheet(sheet) {
  var sheetName = sheet.getName().trim();

  // 1. Cek dari nama tab sheet terlebih dahulu (contoh: "30 OKTOBER 2026", "31 OKTOBER 2026")
  var parsedFromName = extractDateFromString(sheetName);
  if (parsedFromName) return parsedFromName;

  // 2. Cek dari cell A1 sampai C4 di dalam sheet
  try {
    var cells = sheet.getRange("A1:C4").getValues();
    for (var r = 0; r < cells.length; r++) {
      for (var c = 0; c < cells[r].length; c++) {
        var val = cells[r][c];
        if (val instanceof Date && !isNaN(val.getTime())) {
          return val;
        }
        if (typeof val === "string" && val.length > 4) {
          var parsed = extractDateFromString(val);
          if (parsed) return parsed;
        }
      }
    }
  } catch (err) {}

  return null;
}

/**
 * Ekstraksi objek Date dari string bahasa Indonesia atau numerik
 */
function extractDateFromString(str) {
  if (!str) return null;
  var s = str.toUpperCase().trim();

  var months = {
    "JANUARI": 0, "JAN": 0,
    "FEBRUARI": 1, "FEB": 1,
    "MARET": 2, "MAR": 2,
    "APRIL": 3, "APR": 3,
    "MEI": 4,
    "JUNI": 5, "JUN": 5,
    "JULI": 6, "JUL": 6,
    "AGUSTUS": 7, "AGT": 7, "AGU": 7,
    "SEPTEMBER": 8, "SEP": 8,
    "OKTOBER": 9, "OKT": 9,
    "NOVEMBER": 10, "NOV": 10,
    "DESEMBER": 11, "DES": 11
  };

  // Cocokkan pola: "30 OKTOBER 2026"
  var match = s.match(/(\d{1,2})\s+([A-Z]+)\s+(\d{4})/);
  if (match) {
    var day = parseInt(match[1], 10);
    var monthName = match[2];
    var year = parseInt(match[3], 10);
    if (months.hasOwnProperty(monthName)) {
      return new Date(year, months[monthName], day);
    }
  }

  // Cocokkan pola numerik: "30-10-2026" atau "30/10/2026"
  var matchNum = s.match(/(\d{1,2})[-\/](\d{1,2})[-\/](\d{4})/);
  if (matchNum) {
    return new Date(parseInt(matchNum[3], 10), parseInt(matchNum[2], 10) - 1, parseInt(matchNum[1], 10));
  }

  return null;
}

/**
 * Format Date ke format resmi Indonesia
 * Output: JUM’AT, 30 OKTOBER 2026
 */
function formatTanggalIndonesia(d) {
  var hari = ["MINGGU", "SENIN", "SELASA", "RABU", "KAMIS", "JUM’AT", "SABTU"];
  var bulan = ["JANUARI", "FEBRUARI", "MARET", "APRIL", "MEI", "JUNI", 
               "JULI", "AGUSTUS", "SEPTEMBER", "OKTOBER", "NOVEMBER", "DESEMBER"];
  return hari[d.getDay()] + ", " + d.getDate() + " " + bulan[d.getMonth()] + " " + d.getFullYear();
}

function createJsonResponse(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
