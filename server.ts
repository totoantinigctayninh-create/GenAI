import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { ExamSessionEngine } from './src/server/examSessionEngine.ts';
import { createExamSessionRouter } from './src/server/examSessionRoutes.ts';
import {
  createFirestoreExamStorageAdapter,
  syncEngineWithFirestore,
} from './src/server/firestoreExamStorage.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;

  app.use(express.json({ limit: '5mb' }));

  const engine = new ExamSessionEngine({
    storageAdapter: createFirestoreExamStorageAdapter(),
  });

  // Khởi tạo đồng bộ Firestore & tác vụ nền quét hạn nộp định kỳ
  syncEngineWithFirestore(engine).catch((err) => {
    console.warn('Firestore initial sync warning:', err);
  });

  // Mount API Quản lý Ca thi & Phòng thi ("Thi ngay" / "Ca thi")
  app.use('/api', createExamSessionRouter(engine));

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
