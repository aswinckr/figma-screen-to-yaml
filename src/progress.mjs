// Status is stderr-only: elapsed time never changes deterministic export files.
export function createProgress({write=line=>process.stderr.write(line+'\n'),now=()=>performance.now(),setTimer=setInterval,clearTimer=clearInterval,interval=10000}={}) {
  const started=now();let stage='',changed=started,closed=false;
  const emit=message=>write(`[${Math.floor((now()-started)/1000)}s] ${message}`);
  const timer=setTimer(()=>{if(stage&&!closed&&now()-changed>=interval)emit(`Still working: ${stage} (${Math.floor((now()-changed)/1000)}s in this stage)`);},interval);
  timer.unref?.();
  return {
    update(message){if(closed)return;stage=message;changed=now();emit(message);},
    close(){closed=true;clearTimer(timer);},
  };
}
