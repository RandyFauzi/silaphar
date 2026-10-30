<?php
/**
 * BACKEND API & DATABASE SQLITE - REKAPITULASI WBP KALSEL
 * 
 * Mengelola pendaftaran Google Spreadsheet dan penyimpanan data snapshot cache
 * sehingga sekali didaftarkan, data langsung tersimpan di database lokal.
 */

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
if ($method === 'OPTIONS') {
    exit(0);
}

$dbDir = __DIR__ . '/database';
if (!is_dir($dbDir)) {
    mkdir($dbDir, 0755, true);
}
$dbPath = $dbDir . '/spreadsheets.sqlite';

try {
    $db = new PDO('sqlite:' . $dbPath);
    $db->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);

    // Inisialisasi Tabel
    $db->exec("CREATE TABLE IF NOT EXISTS spreadsheets (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        url TEXT NOT NULL,
        last_synced TEXT NOT NULL,
        cached_data TEXT NOT NULL,
        is_default INTEGER DEFAULT 0,
        created_at TEXT NOT NULL
    )");

    $action = $_GET['action'] ?? 'list';

    // 1. LIST: Ambil daftar seluruh spreadsheet terdaftar
    if ($action === 'list') {
        $stmt = $db->query("SELECT id, name, url, last_synced, is_default, created_at, length(cached_data) as data_size FROM spreadsheets ORDER BY is_default DESC, created_at DESC");
        $items = $stmt->fetchAll(PDO::FETCH_ASSOC);

        // Jika database masih kosong, tambahkan spreadsheet default (Oktober 2026)
        if (empty($items)) {
            $defaultId = '1-0rXQqvGqFzgyl48EbLe7Kfbi6Wz1YZ_sDmWoEOLTtw';
            $defaultName = 'Rekapitulasi WBP Oktober 2026 (Default)';
            $defaultUrl = 'https://docs.google.com/spreadsheets/d/' . $defaultId . '/edit';
            $now = date('Y-m-d H:i:s');
            
            $ins = $db->prepare("INSERT INTO spreadsheets (id, name, url, last_synced, cached_data, is_default, created_at) VALUES (?, ?, ?, ?, ?, 1, ?)");
            $ins->execute([$defaultId, $defaultName, $defaultUrl, '-', '', $now]);

            $items = [[
                'id' => $defaultId,
                'name' => $defaultName,
                'url' => $defaultUrl,
                'last_synced' => '-',
                'is_default' => 1,
                'created_at' => $now,
                'data_size' => 0
            ]];
        }

        echo json_encode(['status' => 'success', 'data' => $items]);
        exit;
    }

    // 2. GET: Ambil satu spreadsheet beserta cached snapshot-nya
    if ($action === 'get') {
        $id = $_GET['id'] ?? '';
        if (!$id) {
            echo json_encode(['status' => 'error', 'message' => 'Parameter id dibutuhkan.']);
            exit;
        }

        $stmt = $db->prepare("SELECT * FROM spreadsheets WHERE id = ?");
        $stmt->execute([$id]);
        $row = $stmt->fetch(PDO::FETCH_ASSOC);

        if (!$row) {
            echo json_encode(['status' => 'error', 'message' => 'Spreadsheet tidak ditemukan di database.']);
            exit;
        }

        $parsedData = !empty($row['cached_data']) ? json_decode($row['cached_data'], true) : null;
        echo json_encode([
            'status' => 'success',
            'id' => $row['id'],
            'name' => $row['name'],
            'url' => $row['url'],
            'last_synced' => $row['last_synced'],
            'is_default' => (int)$row['is_default'],
            'cached_data' => $parsedData
        ]);
        exit;
    }

    // 3. SAVE / REGISTER: Daftarkan spreadsheet baru atau update data snapshot
    if ($action === 'save') {
        $rawInput = file_get_contents('php://input');
        $payload = json_decode($rawInput, true);

        if (!$payload || empty($payload['id'])) {
            echo json_encode(['status' => 'error', 'message' => 'Payload JSON tidak valid.']);
            exit;
        }

        $id = trim($payload['id']);
        $name = trim($payload['name'] ?? ('Spreadsheet ' . substr($id, 0, 8)));
        $url = trim($payload['url'] ?? ('https://docs.google.com/spreadsheets/d/' . $id . '/edit'));
        $cachedData = isset($payload['cached_data']) ? (is_string($payload['cached_data']) ? $payload['cached_data'] : json_encode($payload['cached_data'])) : '';
        $now = date('Y-m-d H:i:s');
        $lastSynced = !empty($cachedData) ? $now : ($payload['last_synced'] ?? '-');
        $isDefault = !empty($payload['is_default']) ? 1 : 0;

        // Upsert ke database
        $stmt = $db->prepare("INSERT INTO spreadsheets (id, name, url, last_synced, cached_data, is_default, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                name = excluded.name,
                url = excluded.url,
                last_synced = CASE WHEN excluded.cached_data != '' THEN excluded.last_synced ELSE spreadsheets.last_synced END,
                cached_data = CASE WHEN excluded.cached_data != '' THEN excluded.cached_data ELSE spreadsheets.cached_data END,
                is_default = excluded.is_default");
        $stmt->execute([$id, $name, $url, $lastSynced, $cachedData, $isDefault, $now]);

        echo json_encode([
            'status' => 'success',
            'message' => 'Spreadsheet berhasil disimpan di database.',
            'id' => $id,
            'last_synced' => $lastSynced
        ]);
        exit;
    }

    // 4. DELETE: Hapus spreadsheet dari database
    if ($action === 'delete') {
        $rawInput = file_get_contents('php://input');
        $payload = json_decode($rawInput, true);
        $id = trim($payload['id'] ?? ($_GET['id'] ?? ''));

        if (!$id) {
            echo json_encode(['status' => 'error', 'message' => 'ID dibutuhkan untuk menghapus.']);
            exit;
        }

        $stmt = $db->prepare("DELETE FROM spreadsheets WHERE id = ?");
        $stmt->execute([$id]);

        echo json_encode(['status' => 'success', 'message' => 'Spreadsheet berhasil dihapus dari database.']);
        exit;
    }

    echo json_encode(['status' => 'error', 'message' => 'Aksi tidak dikenali.']);
} catch (Exception $e) {
    echo json_encode(['status' => 'error', 'message' => $e->getMessage()]);
}
