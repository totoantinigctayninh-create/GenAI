type XlsxModule = typeof import('xlsx');

let cachedXlsx: XlsxModule | null = null;
let inflightPromise: Promise<XlsxModule> | null = null;

function normalizeXlsxModule(mod: unknown): XlsxModule {
  const candidate = mod as {
    utils?: unknown;
    read?: unknown;
    write?: unknown;
    default?: XlsxModule;
  };
  if (candidate && candidate.utils && candidate.read && candidate.write) {
    return candidate as unknown as XlsxModule;
  }
  if (candidate?.default && candidate.default.utils) {
    return candidate.default;
  }
  throw new Error('Không thể khởi tạo thư viện xử lý bảng tính Excel (xlsx).');
}

/**
 * Tải lười (lazy-load) thư viện `xlsx` với bộ nhớ đệm và cơ chế tự phục hồi
 * khi Vite dev server vừa cập nhật hash dependency (`504 Outdated Optimize Dep` /
 * `Failed to fetch dynamically imported module`).
 */
export async function loadXlsx(): Promise<XlsxModule> {
  if (cachedXlsx) {
    return cachedXlsx;
  }
  if (inflightPromise) {
    return inflightPromise;
  }

  inflightPromise = (async () => {
    try {
      const mod = await import('xlsx');
      const normalized = normalizeXlsxModule(mod);
      cachedXlsx = normalized;
      return normalized;
    } catch (primaryErr) {
      // Dự phòng trong môi trường dev khi tab trình duyệt đang giữ query ?v=... cũ của Vite
      if (typeof window !== 'undefined' && import.meta.env?.DEV) {
        try {
          const fallbackUrl = '/node_modules/.vite/deps/xlsx.js';
          const fallbackMod = await import(/* @vite-ignore */ fallbackUrl);
          const normalized = normalizeXlsxModule(fallbackMod);
          cachedXlsx = normalized;
          return normalized;
        } catch {
          // Rơi xuống thông báo lỗi thân thiện bên dưới
        }
      }

      const msg =
        primaryErr instanceof Error ? primaryErr.message : String(primaryErr);
      if (
        msg.includes('Failed to fetch dynamically imported module') ||
        msg.includes('Importing a module script failed')
      ) {
        throw new Error(
          'Phiên trình duyệt vừa được cập nhật mô-đun Excel mới. Vui lòng tải lại trang (F5) rồi thử thao tác Excel lại.'
        );
      }
      throw primaryErr;
    } finally {
      inflightPromise = null;
    }
  })();

  return inflightPromise;
}
