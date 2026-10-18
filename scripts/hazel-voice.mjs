#!/usr/bin/env node
/**
 * hazel-voice.mjs — 灰泽满本地声音出口（F5-TTS 零样本，本地非商业验证）。
 *
 * 两条路：
 *   say   把一句话合成成 wav 文件
 *   serve 起一个只监听 127.0.0.1 的小网页：输入文本、点一下、浏览器里直接听
 *
 * 为什么是「本地网页」而不是「DSH 客户端插件」：DSH 目前没有语音输出 seam，
 * 客户端播放要另写客户端插件并重建前端产物；本地服务能用一句话落地，不假装
 * 它能进对话。等真要做进 DSH，再接客户端播放。
 *
 * 前置（见 docs/voice-prototype.md）：
 *   - 本地 F5-TTS 工作区（含 .venv 与克隆的 F5-TTS）；用 HAZEL_TTS_HOME 指定
 *   - 参考音频必须是已获授权、10–30 秒、单人干净的片段
 *
 * 用法：
 *   node scripts/hazel-voice.mjs say "晚上好，灰泽满来了。" --out outputs/voice/demo.wav
 *   node scripts/hazel-voice.mjs say "..." --dry-run          # 只打印将执行的命令
 *   node scripts/hazel-voice.mjs serve                        # 默认 http://127.0.0.1:7788
 *   node scripts/hazel-voice.mjs serve --port 7800 --ref <授权参考音.wav>
 *
 * 环境：
 *   HAZEL_TTS_HOME       F5-TTS 工作区（默认依次探测 ~/hazel-tts、D:\Project\hazel-tts）
 *   HAZEL_TTS_REF        参考音路径（默认用 F5-TTS 自带的 basic_ref_zh.wav，不是她的音色）
 *   HAZEL_TTS_REF_TEXT   参考音文本；不给就先跑 tts-transcribe.py 转写
 *
 * 红线：不发布公开声音服务、不把原声/权重/训练集放进仓库、不冒充她本人。
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function argValue(name, fallback) {
  const index = process.argv.indexOf(name);
  if (index === -1) return fallback;
  return process.argv[index + 1] ?? fallback;
}

const DRY_RUN = process.argv.includes('--dry-run');
const REF_OVERRIDE = argValue('--ref', undefined);
const REF_TEXT_OVERRIDE = argValue('--ref-text', undefined);
const OUT = argValue('--out', path.join(REPO_ROOT, 'outputs', 'voice', 'hazel-voice.wav'));
const PORT = Number(argValue('--port', '7788'));
const HOST = '127.0.0.1';

/** 找一个能跑的 F5-TTS 工作区（必须同时有 .venv 和仓库）。 */
function resolveTtsHome() {
  const candidates = [
    process.env.HAZEL_TTS_HOME,
    path.join(os.homedir(), 'hazel-tts'),
    'D:\\Project\\hazel-tts',
  ];
  for (const dir of candidates) {
    if (!dir) continue;
    if (existsSync(path.join(dir, '.venv', 'Scripts', 'f5-tts_infer-cli.exe'))) return dir;
  }
  return null;
}

/** F5-TTS 自带的示例参考音（中文女声，不是灰泽满）。 */
function defaultRef(ttsHome) {
  return path.join(ttsHome, 'F5-TTS', 'src', 'f5_tts', 'infer', 'examples', 'basic', 'basic_ref_zh.wav');
}

/** 用工作区里的 python 跑 tts-transcribe.py 转写参考音。 */
function transcribeRef(ttsHome, ref) {
  const py = path.join(ttsHome, '.venv', 'Scripts', 'python.exe');
  const helper = path.join(REPO_ROOT, 'scripts', 'tts-transcribe.py');
  if (!existsSync(py) || !existsSync(helper)) return null;
  const tmp = path.join(os.tmpdir(), `hazel-ref-${Date.now()}.txt`);
  try {
    const result = spawnSync(py, [helper, ref, tmp], { stdio: 'ignore' });
    if (result.status !== 0 || !existsSync(tmp)) return null;
    const text = readFileSync(tmp, 'utf8').trim();
    return text.length > 0 ? text : null;
  } catch {
    return null;
  } finally {
    rmSync(tmp, { force: true });
  }
}

/** 组装 f5-tts_infer-cli 的参数；dry-run 与真实执行共用同一份。 */
function buildArgs({ ttsHome, text, outFile }) {
  const ref = REF_OVERRIDE ?? process.env.HAZEL_TTS_REF ?? defaultRef(ttsHome);
  const refText = REF_TEXT_OVERRIDE ?? process.env.HAZEL_TTS_REF_TEXT ?? (DRY_RUN ? '<参考音文本>' : transcribeRef(ttsHome, ref));
  if (!refText) throw new Error('拿不到参考音文本：设置 HAZEL_TTS_REF_TEXT，或直接传 --ref-text');
  return {
    cli: path.join(ttsHome, '.venv', 'Scripts', 'f5-tts_infer-cli.exe'),
    args: [
      '--model', 'F5TTS_v1_Base',
      '--ref_audio', ref,
      '--ref_text', refText,
      '--gen_text', text,
      '--output_dir', path.dirname(outFile),
      '--output_file', path.basename(outFile),
    ],
  };
}

/** 合成一句话到指定文件，返回文件路径。 */
function synthesize(text, outFile) {
  const ttsHome = resolveTtsHome();
  if (!ttsHome) {
    throw new Error('没找到可用的 F5-TTS 工作区：设置 HAZEL_TTS_HOME 指向含 .venv 与 F5-TTS 的目录');
  }
  const spoken = String(text ?? '').trim();
  if (spoken.length === 0) throw new Error('文本为空');
  mkdirSync(path.dirname(outFile), { recursive: true });
  const { cli, args } = buildArgs({ ttsHome, text: spoken, outFile });
  if (DRY_RUN) {
    console.log(`${cli} \\\n  ${args.map((item) => (/[\s]/.test(item) ? `"${item}"` : item)).join(' \\\n  ')}`);
    return outFile;
  }
  const result = spawnSync(cli, args, { stdio: 'inherit' });
  if (result.status !== 0) throw new Error(`F5-TTS 失败，退出码 ${result.status}`);
  if (!existsSync(outFile)) throw new Error(`F5-TTS 跑完了但没生成文件：${outFile}`);
  return outFile;
}

const PAGE = `<!doctype html>
<html lang="zh-CN"><meta charset="utf-8">
<title>灰泽满 · 本地声音</title>
<style>
  :root { color-scheme: light dark; }
  body { font: 15px/1.7 system-ui, "Microsoft YaHei", sans-serif; max-width: 640px; margin: 48px auto; padding: 0 20px; }
  h1 { font-size: 18px; font-weight: 600; margin: 0 0 4px; }
  p.hint { margin: 0 0 20px; opacity: .6; font-size: 13px; }
  textarea { width: 100%; min-height: 96px; padding: 12px; font: inherit; box-sizing: border-box;
             border: 1px solid color-mix(in oklab, currentColor 25%, transparent); border-radius: 8px; background: transparent; color: inherit; }
  button { margin-top: 12px; padding: 8px 18px; font: inherit; border-radius: 8px; cursor: pointer;
           border: 1px solid color-mix(in oklab, currentColor 25%, transparent); background: color-mix(in oklab, currentColor 8%, transparent); color: inherit; }
  button:disabled { opacity: .5; cursor: progress; }
  audio { display: block; width: 100%; margin-top: 20px; }
  #state { margin-top: 10px; font-size: 13px; opacity: .7; min-height: 20px; }
</style>
<h1>灰泽满 · 本地声音</h1>
<p class="hint">F5-TTS 零样本，本地合成。当前参考音不是她本人的音色。</p>
<textarea id="text">晚上好，晚上好。灰泽满来了。</textarea>
<button id="go" type="button">说一句</button>
<div id="state"></div>
<audio id="player" controls></audio>
<script>
  const go = document.getElementById('go');
  const player = document.getElementById('player');
  const state = document.getElementById('state');
  go.addEventListener('click', async () => {
    const text = document.getElementById('text').value.trim();
    if (!text) return;
    go.disabled = true;
    state.textContent = '合成中…（首次调用要加载模型，可能十几秒）';
    try {
      const response = await fetch('/tts', { method: 'POST', headers: { 'content-type': 'text/plain; charset=utf-8' }, body: text });
      if (!response.ok) throw new Error(await response.text());
      const blob = await response.blob();
      player.src = URL.createObjectURL(blob);
      await player.play();
      state.textContent = '好了。';
    } catch (error) {
      state.textContent = '失败：' + error.message;
    } finally {
      go.disabled = false;
    }
  });
</script>
</html>`;

function serve() {
  const ttsHome = resolveTtsHome();
  if (!ttsHome && !DRY_RUN) {
    console.error('FAIL: 没找到可用的 F5-TTS 工作区（设置 HAZEL_TTS_HOME）');
    process.exit(2);
  }
  const server = createServer(async (request, response) => {
    if (request.method === 'POST' && request.url === '/tts') {
      let body = '';
      for await (const chunk of request) body += chunk;
      const text = body.trim().slice(0, 200);
      if (text.length === 0) {
        response.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' });
        response.end('文本为空');
        return;
      }
      const outFile = path.join(os.tmpdir(), `hazel-voice-${Date.now()}.wav`);
      try {
        synthesize(text, outFile);
        const audio = readFileSync(outFile);
        response.writeHead(200, { 'content-type': 'audio/wav', 'content-length': audio.length });
        response.end(audio);
      } catch (error) {
        response.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
        response.end(error instanceof Error ? error.message : String(error));
      } finally {
        rmSync(outFile, { force: true });
      }
      return;
    }
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(PAGE);
  });
  server.listen(PORT, HOST, () => {
    console.log(`灰泽满本地声音： http://${HOST}:${PORT}`);
    console.log(`TTS 工作区   : ${ttsHome}`);
    console.log('Ctrl+C 结束。只监听本机，不对外。');
  });
}

const command = process.argv[2] ?? 'help';
if (command === 'say') {
  const text = process.argv[3];
  if (!text) {
    console.error('用法：node scripts/hazel-voice.mjs say "要说的句子" [--out file.wav]');
    process.exit(2);
  }
  try {
    const file = synthesize(text, OUT);
    console.log(`${DRY_RUN ? 'dry-run' : 'ok'}: ${file}`);
  } catch (error) {
    console.error(`FAIL: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(2);
  }
} else if (command === 'serve') {
  serve();
} else {
  console.log('用法：');
  console.log('  node scripts/hazel-voice.mjs say "一句话" [--out file.wav] [--ref 参考音.wav] [--dry-run]');
  console.log('  node scripts/hazel-voice.mjs serve [--port 7788] [--ref 参考音.wav]');
}
