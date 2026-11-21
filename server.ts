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

  // Khởi tải dữ liệu duy nhất 1 lần từ Firestore vào RAM máy chủ (không mở onSnapshot trùng lặp)
  syncEngineWithFirestore(engine, appDataStore).catch((err) => {
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

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
