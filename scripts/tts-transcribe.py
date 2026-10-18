import sys

from f5_tts.infer.utils_infer import transcribe

# Wrapper 用：把参考音转写结果写到文件，避免 PowerShell 捕获 stdout 时被
# 库的 warning / 编码问题污染。
text = transcribe(sys.argv[1])
with open(sys.argv[2], "w", encoding="utf-8") as fh:
    fh.write(text)
