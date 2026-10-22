#!/usr/bin/env bash
# TheMasterplan 权威验证入口 — HazePersona
# 非交互；失败返回非零；不依赖本机绝对路径；不执行部署/发布/远端修改。
set -euo pipefail
cd "$(dirname "$0")/.."

fail=0

# 1) 插件语法（node 缺失视为失败——与 check.ps1 委托语义一致，不跳过）
if command -v node >/dev/null 2>&1; then
  if node --check plugin/dsh-persona-hazel/index.js \
    && node --check plugin/dsh-persona-hazel/recall.mjs; then
    echo "ok: plugin syntax"
  else
    echo "FAIL: plugin syntax"
    fail=1
  fi
else
  echo "FAIL: node not found (required for plugin syntax check)"
  fail=1
fi

# 2) 脚本语法（DSH 端到端验证、召回数据构建、人格评测、召回质量评测）
if node --check deploy/verify-live.mjs \
  && node --check scripts/build-recall-data.mjs \
  && node --check scripts/recall-eval.mjs \
  && { [ ! -f scripts/persona-eval.mjs ] || node --check scripts/persona-eval.mjs; }; then
  echo "ok: script syntax"
else
  echo "FAIL: script syntax"
  fail=1
fi

# 3) 召回数据与 persona/ 源数据同步（构建产物不得过期）
if output=$(node scripts/build-recall-data.mjs --check 2>&1); then
  echo "ok: recall-data.json in sync"
else
  printf '%s\n' "$output"
  echo "FAIL: recall-data.json is out of date (run node scripts/build-recall-data.mjs)"
  fail=1
fi

# 4) 召回逻辑单测
if output=$(node --test plugin/dsh-persona-hazel/test/recall.test.mjs plugin/dsh-persona-hazel/test/plugin.test.mjs 2>&1); then
  echo "ok: recall unit tests"
else
  printf '%s\n' "$output"
  echo "FAIL: recall unit tests"
  fail=1
fi

# 5) 人设卡同步一致性（soul-card.md、haze-persona.txt、插件 persona.txt 三者必须一致）
if cmp -s persona/soul-card.md plugin/dsh-persona-hazel/persona.txt \
  && cmp -s persona/soul-card.md persona/haze-persona.txt; then
  echo "ok: persona.txt and haze-persona.txt in sync with soul-card.md"
else
  echo "FAIL: plugin persona.txt or haze-persona.txt differs from persona/soul-card.md (run deploy.ps1; resync haze-persona.txt)"
  fail=1
fi

# 6) 人格锚点
if grep -q "永远16岁的风纪委员" persona/soul-card.md; then
  echo "ok: persona anchors present"
else
  echo "FAIL: persona anchors missing"
  fail=1
fi

# 7) 召回质量回归（确定性标注集 + 离线评测，不连 DSH）
if output=$(node scripts/recall-eval.mjs --strict 2>&1); then
  echo "ok: recall quality regression"
else
  printf '%s\n' "$output"
  echo "FAIL: recall quality regression (run node scripts/recall-eval.mjs --verbose)"
  fail=1
fi

# 8) bundle 元数据（DSH 插件页只列 bundle：没有 dsh.bundle.patch 的包在插件页
#    里根本不出现，插件只能靠 profile 的 insert 行活着，用户也就关不掉它）
if output=$(node --input-type=module -e '
import { readFileSync } from "node:fs";
const pkg = JSON.parse(readFileSync("plugin/dsh-persona-hazel/package.json", "utf8"));
const patch = "./cordis.patch.yml";
const declared = pkg?.dsh?.bundle?.patch;
if (declared !== patch) throw new Error(`dsh.bundle.patch must be ${patch} (got ${declared})`);
if (!(pkg.files || []).includes(patch.replace(/^\.\//, ""))) throw new Error(`${patch} missing from package files[]`);
const text = readFileSync(`plugin/dsh-persona-hazel/${patch.slice(2)}`, "utf8");
if (!/^\s*-\s*id:\s*persona-hazel\s*$/m.test(text)) throw new Error(`${patch} has no persona-hazel insert row`);
if (!text.includes(pkg.name)) throw new Error(`${patch} does not reference ${pkg.name}`);
console.log("bundle metadata ok");
' 2>&1); then
  echo "ok: bundle metadata"
else
  printf '%s\n' "$output"
  echo "FAIL: bundle metadata (the DSH Plugins page would not list dsh-persona-hazel)"
  fail=1
fi

if [ "$fail" -ne 0 ]; then
  echo "check failed"
  exit 1
fi
echo "all checks passed"
