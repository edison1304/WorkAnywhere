# WorkAnywhere 모바일 확장 — 작업 핸드오프

## 현재 상태 (2026-05-18)

### 완료된 작업

#### 1. API Gateway (`packages/gateway/`)
서버에서 실행되는 Node.js HTTP/WebSocket 서버. **동작 확인 완료.**

- Express REST API: Project/Phase/Task CRUD + Agent 제어
- WebSocket 싱크 채널: `fs.watch`로 `log.ndjson` 감시 → 실시간 push
- GatewaySync: 데스크톱 SyncService와 동일한 flock 프로토콜 사용
- AgentBridge: claude CLI를 `child_process.spawn`으로 실행
- Bearer 토큰 인증 (`~/.workanywhere/.gateway-token`)
- Node 16에서 동작 (서버 GLIBC 제약)

**기동 방법:**
```bash
cd packages/gateway && npm install && npx tsx src/server.ts
# http://0.0.0.0:3847 에서 서빙
```

**테스트 결과:**
- GET /health → OK
- GET /api/projects → 프로젝트 리스트 OK
- GET /api/phases, /api/tasks → OK
- POST/PUT/DELETE CRUD → OK
- 인증 없이 요청 → 401 OK
- Sync 이벤트 log.ndjson 기록 → OK

#### 2. Android 앱 소스코드 (`packages/mobile-app/`)
React Native Android 앱. **소스코드 완성, 빌드는 Android SDK 환경에서 필요.**

구조:
```
src/
  App.tsx                    — 메인 컨트롤러 (SSH → Gateway → 네비게이션)
  api/client.ts              — REST + WebSocket 타입드 클라이언트
  hooks/useSync.ts           — 실시간 상태 동기화 (desktop SyncService와 동일 로직)
  services/SSHTunnel.ts      — SSH 연결 + 포트포워딩 + Gateway 자동 시작
  components/
    screens/
      SetupScreen.tsx        — SSH 접속 정보 입력 (host, port, user, pw/key)
      ProjectListScreen.tsx  — 프로젝트 목록
      TaskListScreen.tsx     — Phase별 Task 목록
      TaskChatScreen.tsx     — 채팅 UI (바이브코딩 핵심)
    common/
      StatusBadge.tsx        — 상태 배지
      ChatBubble.tsx         — LogEntry → 채팅 버블
      PermissionBanner.tsx   — 퍼미션 승인/거부 배너
  styles/theme.ts            — 다크 테마 색상
```

#### 3. 공유 코드 (`shared/`)
- `apiContract.ts` — Gateway REST/WS API 계약 (타입 정의)
- DataStore에 `IPersistence` 인터페이스 도입 (데스크톱 호환 유지)

---

### 앱 동작 흐름
```
SetupScreen (SSH 정보 입력)
    ↓
SSHTunnel.connect() — SSH 연결 + localhost:3847 포트포워딩
    ↓
SSHTunnel.ensureGateway() — Gateway 실행 확인 + 토큰 자동 획득
    ↓
GatewayClient(localhost:3847, token) — REST + WebSocket
    ↓
ProjectList → TaskList → TaskChat (에이전트 채팅)
```

---

### 다음 단계 (Android SDK 환경에서)

1. **React Native 프로젝트 초기화**
   ```bash
   npx react-native init WorkAnywhere --directory packages/mobile-app
   ```
   이렇게 하면 `android/` 폴더가 생성됨. 기존 `src/` 파일들은 그대로 유지.

2. **의존성 설치**
   ```bash
   cd packages/mobile-app
   npm install
   # react-native-ssh-sftp는 네이티브 모듈이라 link 필요할 수 있음
   ```

3. **react-native-ssh-sftp 설정**
   - Android: `android/app/build.gradle`에 자동 link 확인
   - 포트포워딩 기능이 없으면 `SSHTunnel.ts`에서 native bridge 직접 구현 필요
   - 대안: `react-native-tcp-socket`으로 직접 SSH 터널 구현

4. **빌드 & 실행**
   ```bash
   npm run android
   ```

5. **테스트**
   - SSH 접속 정보 입력 → 연결 확인
   - 프로젝트 리스트 표시
   - Task 채팅 화면에서 에이전트 인터랙션

---

### 주의사항

- **Gateway는 서버에서 먼저 실행되어야 함** (앱의 `ensureGateway()`가 자동 시작 시도하지만, 최초 설치는 수동)
- **react-native-ssh-sftp의 포트포워딩 지원 여부 확인 필요** — 미지원 시 대안 라이브러리 검토
- **Node 16 호환**: 서버 GLIBC 2.4 제약으로 Node 18+ 사용 불가. `crypto.randomUUID()` 대신 `randomUUID()` import 사용
- **데스크톱과 Gateway 공존**: 동일한 `log.ndjson` + flock 프로토콜 → 프로토콜 변경 없이 호환
