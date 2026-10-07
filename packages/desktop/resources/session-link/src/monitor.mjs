export const monitor = `<!doctype html>
<html lang="ru"><meta charset="utf-8"><title>OpenCode · тестовый монитор веток</title>
<style>body{font:15px system-ui;background:#e6e0d4;color:#242320;max-width:1100px;margin:32px auto;padding:0 20px}input,button{font:inherit;padding:8px;margin:4px}article{background:#f4f1ea;border:1px solid #c9c3b7;border-radius:10px;padding:16px;margin:12px 0}pre{white-space:pre-wrap;overflow-wrap:anywhere}.muted{color:#666}time{font-variant-numeric:tabular-nums}</style>
<h1>Живой монитор тестовых веток</h1><p>Статус сервера и активность ветки — разные вещи. Долгое молчание не доказывает зависание.</p>
<form id="login"><input id="sender" value="python-mailer" aria-label="Отправитель"><input id="key" type="password" placeholder="Секретный стук" aria-label="Секретный стук"><button>Подключить монитор</button></form>
<p id="status" class="muted">Не подключён</p><main id="branches"></main>
<script>
const status = document.querySelector('#status'), branches = document.querySelector('#branches');
let controller, current, browserConnected = false, transportError = '';
const format = value => value ? new Date(value).toLocaleString() : 'нет наблюдения';
function render(value) {
  current = value;
  status.textContent = 'Монитор ↔ шлюз: ' + (browserConnected ? 'подключён' : 'НЕ ПОДКЛЮЧЁН — сохранённый снимок устарел') + (transportError ? ' · ' + transportError : '') + ' · шлюз ↔ OpenCode (в последнем снимке): ' + (value.connected ? 'подключён' : 'не подключён') + ' · ответ сервера: ' + format(value.lastServerReplyAt) + (value.serverResponding===false ? ' · последняя проверка сервера не получила ответа' : '') + (value.gapObserved ? ' · был разрыв наблюдения; пропущенные события неизвестны' : '') + (value.snapshotError ? ' · текущее состояние не удалось перечитать' : '');
  if(value.recovering)status.textContent += ' · перечитываю состояние после подключения; снимки ещё не подтверждены';
  branches.replaceChildren();
  for (const branch of value.branches) {
    const card = document.createElement('article'), title = document.createElement('strong'), detail = document.createElement('pre');
    title.textContent = branch.title;
    const silence = branch.lastObservedEventAt ? Math.floor((Date.now()-branch.lastObservedEventAt)/1000) + ' с' : 'нет live-события после подключения';
    detail.textContent = branch.sessionID + '\\nСостояние: ' + branch.phase + ' · активна: ' + branch.active + '\\nШаг: ' + (branch.stepID || 'не наблюдался') + '\\nИнструменты: ' + JSON.stringify(branch.tools) + '\\nОчередь: ' + branch.queued + ' · запросы разрешения: ' + branch.permissionIDs.length + '\\nПоследнее событие: ' + format(branch.lastActivityAt) + ' (' + silence + ')' + '\\nСнимок текущего состояния: ' + format(branch.snapshotAt);
    card.append(title, detail); branches.append(card);
  }
}
document.querySelector('#login').onsubmit = async event => {
  event.preventDefault(); controller?.abort(); controller = new AbortController();
  const ownController = controller; browserConnected = false; transportError = '';
  const headers = {'X-Session-Link-Sender':document.querySelector('#sender').value, 'Authorization':'Bearer '+document.querySelector('#key').value};
  try {
    const initial = await fetch('/activity',{headers,signal:ownController.signal});
    if(!initial.ok) throw new Error('Доступ отклонён: HTTP '+initial.status);
    render(await initial.json());
    if(controller!==ownController)return;
    const response = await fetch('/events',{headers,signal:ownController.signal});
    if(!response.ok) throw new Error('Поток недоступен: HTTP '+response.status);
    browserConnected = true; render(current);
    const reader = response.body.getReader(), decoder = new TextDecoder(); let buffer = '';
    while(true){const item = await reader.read(); if(item.done) break; buffer += decoder.decode(item.value,{stream:true}); let end; while((end=buffer.indexOf('\\n\\n'))>=0){const frame=buffer.slice(0,end);buffer=buffer.slice(end+2);if(frame.startsWith('data: '))render(JSON.parse(frame.slice(6)));}}
    if(controller===ownController){browserConnected=false;transportError='Поток закрыт, подключись повторно';if(current)render(current);}
  } catch(error) { if(controller===ownController && error.name!=='AbortError'){browserConnected=false;transportError=error.message;if(current)render(current);else status.textContent=transportError;} }
};
setInterval(()=>{if(current)render(current)},1000);
</script></html>`
