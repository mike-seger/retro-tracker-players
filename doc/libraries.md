**Audio playback libraries:**

| Engine | Library | Version | Source |
| --- | --- | --- | --- |
| MOD/XM/S3M/IT | **chiptune3**(AudioWorklet) | `0.8` | CDN:`npm/chiptune3@0.8` |
| MOD/XM/S3M/IT | **chiptune2**(ScriptProcessor fallback) | [master](vscode-file://vscode-app/Applications/Visual%20Studio%20Code.app/Contents/Resources/app/out/vs/code/electron-browser/workbench/workbench.html) | CDN:[gh/deskjet/chiptune2.js@master](vscode-file://vscode-app/Applications/Visual%20Studio%20Code.app/Contents/Resources/app/out/vs/code/electron-browser/workbench/workbench.html) |
| MOD/XM/S3M/IT | **libopenmpt**(Wasm, bundled with chiptune2) | unknown (no version string) | vendored locally |
| SID (primary) | **WebSid**(Tiny'R'Sid) | `1.1` | bundled locally |
| SID (primary) | **scriptprocessor\_player**(WebSid stdlib) | `1.3` | bundled locally |
| SID (fallback) | **jsSID**by Hermit | `0.9.1` | bundled locally |
| AHX | **AHXMaster** | unknown | bundled locally |
