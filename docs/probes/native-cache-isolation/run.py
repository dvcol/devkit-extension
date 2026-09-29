from pathlib import Path
import subprocess,os,json
root=Path('/private/tmp/devkit-startup-diagnosis')
processes=[]
for browser in ['chromium','firefox']:
 stream=(root/f'{browser}.log').open('w')
 process=subprocess.Popen(['/opt/homebrew/bin/node',str(root/f'{browser}.mjs')],stdout=stream,stderr=subprocess.STDOUT,cwd='/Users/dinh-van.colomban/Workspace/private/devkit-extension/examples/webext')
 processes.append((browser,process,stream))
results={}
for browser,process,stream in processes:
 results[browser]=process.wait()
 stream.close()
(root/'result.json').write_text(json.dumps(results,indent=2))
print(results)
