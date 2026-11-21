import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { createAppDataRouter } from './src/server/appDataRoutes.ts';
import { ServerAppDataStore } from './src/server/appDataStore.ts';
import { ExamSessionEngine } from './src/server/examSessionEngine.ts';
import { createExamSessionRouter } from './src/server/examSessionRoutes.ts';
import {
  createFirestoreAppDataPersistenceAdapter,
  createFirestoreExamStorageAdapter,
  fetchQuestionCountFromFirestore,
  lookupUserFromFirestore,
  syncEngineWithFirestore,
} from './src/server/firestoreExamStorage.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;

  app.use(express.json({ limit: '5mb' }));

  let appDataStoreRef: ServerAppDataStore | undefined;

  const engine = new ExamSessionEngine({
    storageAdapter: createFirestoreExamStorageAdapter(() => appDataStoreRef),
  });

  const appDataStore = new ServerAppDataStore(
    engine,
    createFirestoreAppDataPersistenceAdapter(() => {
      appDataStoreRef?.markFirestoreQuotaExceeded(true);
    })
  );
  appDataStoreRef = appDataStore;

  let stopBackgroundTimers: (() => void) | undefined;

  // Khởi tải dữ liệu duy nhất 1 lần từ Firestore vào RAM máy chủ (không mở onSnapshot trùng lặp)
  syncEngineWithFirestore(engine, appDataStore)
    .then((cleanup) => {
      stopBackgroundTimers = cleanup;
    })
    .catch((err) => {
      console.warn('Firestore initial sync warning:', err);
    });

  // Mount API Write-Through Cache đọc/ghi qua RAM máy chủ (0 lượt đọc Firestore phía trình duyệt)
  app.use('/api', createAppDataRouter(appDataStore));

  // Mount API Quản lý Ca thi & Phòng thi ("Thi ngay" / "Ca thi") & Xác thực phiên
  app.use(
    '/api',
    createExamSessionRouter(engine, {
      lookupUser: lookupUserFromFirestore,
      fetchQuestionCount: fetchQuestionCountFromFirestore,
      appDataStore,
    })
  );

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const httpServer = app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });

  // Đảm bảo không mất dữ liệu bài thi đang làm khi máy chủ khởi động lại / triển khai mới
  let isShuttingDown = false;
  const handleGracefulShutdown = async (signal: string) => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    console.log(`Received ${signal}. Flushing dirty live exam attempts before exit...`);

    stopBackgroundTimers?.();

    const safetyTimeout = setTimeout(() => {
      process.exit(0);
    }, 10_000);
    safetyTimeout.unref?.();

    try {
      const flushedIds = await engine.flushDirtyAttempts();
      console.log(
        `Graceful shutdown flush completed (${flushedIds.length} dirty attempt(s) saved).`
      );
    } catch (err) {
      console.warn('Graceful shutdown flush warning:', err);
    }

    httpServer.close(() => {
      clearTimeout(safetyTimeout);
      process.exit(0);
    });
  };

  process.on('SIGTERM', () => {
    void handleGracefulShutdown('SIGTERM');
  });
  process.on('SIGINT', () => {
    void handleGracefulShutdown('SIGINT');
  });
}

startServer();
