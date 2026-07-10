#!/usr/bin/env node
// 포트폴리오 "오늘의 작업 추천" 브리핑을 카카오톡 '나에게 보내기'로 전송합니다.
// 사용법: node scripts/kakao-briefing.mjs
// 사전 준비: 프로젝트 빌드(npm run build), config.json의 kakao 설정 + kakao auth 완료.
// 이 스크립트는 portfolio-tracker가 설치된 본인 Mac에서 실행하세요(카카오 API 접근 필요).

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

// 빌드 산출물에서 직접 import (CLI와 동일한 인증 경로 사용)
const { ConfigManager } = await import(path.join(ROOT, "dist/config/ConfigManager.js"));
const { KakaoNotifier } = await import(path.join(ROOT, "dist/core/KakaoNotifier.js"));

const CLI = path.join(ROOT, "dist/cli/index.js");

// ANSI 컬러 코드 제거
const stripAnsi = (s) => s.replace(/\[[0-9;]*m/g, "");

async function runCli(args) {
  const { stdout } = await execFileAsync("node", [CLI, ...args], {
    cwd: ROOT,
    maxBuffer: 10 * 1024 * 1024,
  });
  return stripAnsi(stdout);
}

// recommend 출력 파싱 → 압축 브리핑(<=200자) 생성
function buildMessage(recommendOut) {
  const lines = recommendOut.split("\n");
  const picks = [];
  let current = null;
  let forgotten = null;

  for (const raw of lines) {
    const line = raw.trim();

    // "1. Cleanera (90점)"
    const head = line.match(/^(\d+)\.\s+(.+?)\s+\((\d+)점\)/);
    if (head) {
      current = { name: head[2], score: head[3], next: null };
      picks.push(current);
      continue;
    }
    // 첫 번째 "→ 작업" 만 채택
    const next = line.match(/^→\s+(.+)$/);
    if (next && current && !current.next) {
      current.next = next[1];
      continue;
    }
    // "discord-kakao-translator - 85% 완료, 61일 전 마지막 활동"
    const forg = line.match(/^([\w.-]+)\s+-\s+(\d+)%\s*완료.*?(\d+)일/);
    if (forg && !forgotten) {
      forgotten = `${forg[1]} ${forg[2]}%(${forg[3]}일)`;
    }
  }

  const shortNext = (t) => (t && t.length > 16 ? t.slice(0, 15) + "…" : t || "");
  const body = picks
    .slice(0, 3)
    .map((p, i) => `${i + 1}.${p.name} ${p.score}점→${shortNext(p.next)}`)
    .join("\n");

  let msg = `[오늘의 추천]\n${body}`;
  if (forgotten) msg += `\n💤잊음: ${forgotten}`;
  return msg;
}

async function main() {
  const recommendOut = await runCli(["recommend", "-r", "-n", "3"]);
  const message = buildMessage(recommendOut);

  const config = await new ConfigManager().load();
  const notifier = KakaoNotifier.configured(config.kakao);
  const status = await notifier.status();
  if (!status.configured) throw new Error("카카오 REST API 키 미설정 (config.json kakao.restApiKey)");
  if (!status.hasToken) throw new Error("카카오 토큰 없음 — 먼저 `portfolio-tracker kakao auth` 실행");

  await notifier.sendTextToMe(message, { screen: "recommendations" });
  console.log("✅ 카카오톡 전송 완료\n--- 보낸 내용 ---\n" + message);
}

main().catch((err) => {
  console.error("❌ 전송 실패:", err?.message ?? err);
  process.exit(1);
});
