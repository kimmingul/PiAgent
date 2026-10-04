using System;
using System.Threading.Tasks;
using System.Collections.Generic;
using System.Web.Script.Serialization;
using Microsoft.Web.WebView2.Core;

internal static class UiSmoke
{
    internal static async Task Run(CoreWebView2 core)
    {
        var sent=new List<string>();var json=new JavaScriptSerializer();
        core.WebMessageReceived+=(_,args)=>sent.Add(args.WebMessageAsJson);
        // Exercise the shipped page and real browser/CSP, with deterministic host replies.
        for (int i = 0; i < 100; i++) {
            if (await core.ExecuteScriptAsync("document.documentElement.lang !== 'en' && !!window.piagentPost") == "true") break;
            await Task.Delay(50);
        }
        core.PostWebMessageAsJson("{\"type\":\"session\",\"sessionId\":\"smoke\",\"writeEnabled\":true,\"usageEnabled\":false,\"sessionsEnabled\":true,\"transcript\":[{\"role\":\"user\",\"text\":\"<script>bad()</script>\"},{\"role\":\"assistant\",\"text\":\"**원본 UI**\"}]}");
        await Task.Delay(150);
        await Check(core, "document.querySelector('.user-text').textContent === '<script>bad()</script>' && document.querySelector('.markdown-body strong').textContent === '원본 UI'", "history and Markdown");
        await Check(core,"['Program.cs:3','View.xaml:2','Main.fmx:1','MAIN.PAS:4'].every(text=>{const holder=document.createElement('div');holder.innerHTML=Markdown.render('`'+text+'`');const ref=holder.querySelector('.file-ref');return ref && ref.dataset.path===text.split(':')[0] && ref.dataset.line===text.split(':')[1];}) && !Markdown.linkFileRefs('Unknown.exe:1').includes('file-ref')","IDE-neutral CSharp/XAML/FMX/Pascal file references preserve paths and line numbers");
        core.PostWebMessageAsJson("{\"type\":\"event\",\"data\":{\"sessionId\":\"smoke\",\"turnId\":\"t\",\"sequence\":1,\"kind\":\"started\"}}");
        core.PostWebMessageAsJson("{\"type\":\"event\",\"data\":{\"sessionId\":\"smoke\",\"turnId\":\"t\",\"sequence\":2,\"kind\":\"approval_requested\",\"approval\":{\"proposalId\":\"p\",\"path\":\"A.cs\",\"diff\":\"-old\\n+new\",\"reason\":\"fixture\"}}}");
        await Task.Delay(150);
        await Check(core, "document.querySelector('.approval-card .diff-add').textContent === '+ new' && document.querySelectorAll('.approval-card button').length === 2", "original inline approval card");
        core.PostWebMessageAsJson("{\"type\":\"event\",\"data\":{\"sessionId\":\"smoke\",\"turnId\":\"t\",\"sequence\":3,\"kind\":\"approval_resolved\",\"approval\":{\"approved\":false}}}");
        core.PostWebMessageAsJson("{\"type\":\"event\",\"data\":{\"sessionId\":\"smoke\",\"turnId\":\"t\",\"sequence\":4,\"kind\":\"completed\"}}");
        core.PostWebMessageAsJson("{\"type\":\"sessions\",\"sessions\":[{\"savedSessionId\":\"saved\",\"title\":\"<img src=x onerror=bad()>\",\"resumable\":true,\"updatedAt\":0}]}");
        await Task.Delay(150);
        await Check(core, "!document.getElementById('sheet').hidden && !document.querySelector('#sheet-body img') && document.querySelector('.approval-card.refused') !== null", "session overlay and safe labels");
        core.PostWebMessageAsJson("""{"type":"session","sessionId":"native","ompControlsEnabled":true,"ompProfile":"native"}""");
        core.PostWebMessageAsJson("""{"type":"ompControl","command":"get_available_models","data":{"models":[{"provider":"fixture","id":"model","name":"Model"}]}}""");
        core.PostWebMessageAsJson("""{"type":"ompControl","command":"get_available_thinking_levels","data":{"levels":["off","high"]}}""");
        await Task.Delay(150);
        await Check(core, "!document.getElementById('model-btn').disabled && !document.getElementById('thinking-select').disabled", "negotiated original model/effort controls enabled");
        core.PostWebMessageAsJson("""{"type":"event","data":{"sessionId":"native","sequence":1,"kind":"omp_event","frame":{"type":"extension_ui_request","method":"confirm","id":"confirm","title":"<img onerror=bad()>","message":"Confirm fixture"}}}""");
        await Task.Delay(150);
        await Check(core, "document.querySelectorAll('.action-card .card-btn').length === 3 && !document.querySelector('.action-card img')", "safe OMP confirmation card");
        core.PostWebMessageAsJson("""{"type":"disconnected"}""");
        await Task.Delay(150);
        await Check(core, "!document.querySelector('.action-card')", "expired interaction removed on disconnect");
        await Check(core,"document.getElementById('model-btn').disabled && document.getElementById('thinking-select').disabled","disconnect disables stale capabilities");
        core.PostWebMessageAsJson("""{"type":"session","sessionId":"complete","savedSessionId":"stable","transcript":[{"role":"user","text":"Preserved conversation"}],"btwEnabled":true,"preferencesEnabled":true,"attachmentsEnabled":true,"exportEnabled":true,"ompControlsEnabled":true,"ompProfile":"native"}""");
        await Task.Delay(150);
        await Check(core,"!document.getElementById('btw-btn').disabled && !document.getElementById('export-btn').disabled && !document.getElementById('plus-btn').disabled","new capabilities enable original controls");
        sent.Clear();
        await core.ExecuteScriptAsync("document.getElementById('sheet').hidden=true;ChatComposer.setInput('/btw 별도 질문');document.getElementById('send-btn').click();");
        await Task.Delay(100);
        var question=sent.Find(message=>message.Contains("\"action\":\"btw\""))??throw new Exception("BTW composer did not reach host");
        var request=json.Deserialize<Dictionary<string,object>>(question);var id=request["id"];
        core.PostWebMessageAsJson(json.Serialize(new {type="operationError",action="btw",id,message="fixture failure"}));
        await Task.Delay(100);await Check(core,"document.getElementById('input').value === '/btw 별도 질문'","BTW error keeps draft");
        sent.Clear();await core.ExecuteScriptAsync("document.getElementById('send-btn').click();");await Task.Delay(100);
        request=json.Deserialize<Dictionary<string,object>>(sent.Find(message=>message.Contains("\"action\":\"btw\""))!);
        core.PostWebMessageAsJson(json.Serialize(new {type="btwAccepted",id=request["id"]}));await Task.Delay(100);
        await Check(core,"document.getElementById('input').value === ''","BTW accepted clears acknowledged draft");
        core.PostWebMessageAsJson("""{"type":"event","data":{"sessionId":"complete","sequence":1,"kind":"omp_event","frame":{"type":"ui_event","event":{"t":"btw","turn":0,"topic":{"id":"topic","mainSession":"stable","mainTitle":"Fixture","created":"now","turns":[{"q":"별도 질문","a":"답변","state":"done","asked":"now"}]}}}}}""");
        await Task.Delay(100);await Check(core,"document.querySelector('.btw-card .btw-answer').textContent.includes('답변')","BTW answer uses original folded card");
        sent.Clear();await core.ExecuteScriptAsync("document.getElementById('btw-btn').click();");await Task.Delay(100);
        await Check(core,"!document.getElementById('btw-panel').hidden","BTW button opens notes");
        if(!sent.Exists(message=>message.Contains("\"action\":\"btwList\"")))throw new Exception("BTW notes did not request list");
        sent.Clear();await core.ExecuteScriptAsync("const side=document.getElementById('btw-new-input');side.value='노트 질문';side.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));");await Task.Delay(100);
        request=json.Deserialize<Dictionary<string,object>>(sent.Find(message=>message.Contains("\"action\":\"btw\""))!);
        await Check(core,"document.getElementById('btw-new-input').disabled && document.getElementById('btw-new-input').value==='노트 질문'","BTW notes wait for acknowledgement");
        core.PostWebMessageAsJson(json.Serialize(new {type="operationError",action="btw",id=request["id"],message="side failed"}));await Task.Delay(100);
        await Check(core,"!document.getElementById('btw-new-input').disabled && document.getElementById('btw-new-input').value==='노트 질문'","BTW notes failure keeps draft");
        await core.ExecuteScriptAsync("ChatBtw.close();document.getElementById('settings-btn').click();");await Task.Delay(100);
        if(!sent.Exists(message=>message.Contains("\"action\":\"preferences\"")))throw new Exception("Settings did not request preferences");
        core.PostWebMessageAsJson("""{"type":"preferences","values":{"language":"ko","fontSize":13,"showThinking":true,"showTools":true,"showTodos":true,"showSubagents":true,"notifications":false,"highContrast":false,"defaultApproval":"always-ask"},"ompExecutable":"fixture","ompProfile":"native"}""");
        await Task.Delay(150);await Check(core,"document.querySelectorAll('[role=tab]').length === 5 && !document.getElementById('sheet').hidden","settings preserves five original areas");
        await Check(core,"document.getElementById('title-btn').textContent.includes('Preserved conversation') && document.getElementById('conn-dot').title !== '연결 중'","translation refresh preserves conversation title and live connection state: "+await core.ExecuteScriptAsync("JSON.stringify({title:document.getElementById('title-btn').textContent,state:document.getElementById('conn-dot').title})"));
        sent.Clear();await core.ExecuteScriptAsync("const font=document.querySelector('#sheet-body input[type=number]');font.value='17';font.dispatchEvent(new Event('change'));Array.from(document.querySelectorAll('#sheet-body button')).find(b=>b.textContent==='적용').click();");await Task.Delay(100);
        if(!sent.Exists(message=>message.Contains("\"fontSize\":17")))throw new Exception("Settings apply did not reach host");
        core.PostWebMessageAsJson("""{"type":"operationError","action":"preferences","message":"fixture disk full"}""");await Task.Delay(100);
        await Check(core,"!document.getElementById('sheet').hidden && document.querySelector('#sheet-body [role=status]').textContent.includes('disk full')","settings save failure keeps sheet open");
        sent.Clear();await core.ExecuteScriptAsync("document.getElementById('sheet').hidden=true;ChatComposer.setInput('@Main');document.getElementById('input').dispatchEvent(new Event('input'));");await Task.Delay(100);
        if(!sent.Exists(message=>message.Contains("\"action\":\"listFiles\"")))throw new Exception("@ completion did not request workspace files");
        core.PostWebMessageAsJson("""{"type":"files","items":["Main.cs","Main.xaml"]}""");await Task.Delay(100);
        await Check(core,"document.getElementById('slash-menu').textContent.includes('Main.cs')","@ completion renders returned files");
        core.PostWebMessageAsJson("""{"type":"event","data":{"sessionId":"complete","turnId":"busy","sequence":2,"kind":"started"}}""");
        core.PostWebMessageAsJson("""{"type":"preferences","values":{"language":"ko","fontSize":13}}""");await Task.Delay(200);
        await Check(core,"document.getElementById('approval-select').disabled && document.getElementById('model-btn').disabled && document.getElementById('input').placeholder.includes('omp 작업 중') && document.getElementById('input').value === '@Main'","translation refresh preserves busy capability gates and draft");
        core.PostWebMessageAsJson("""{"type":"session","sessionId":"plan-check","approvalMode":"plan","transcript":[{"role":"event","text":"","event":{"t":"plan","path":"docs/plans/fixture.md","title":"Fixture plan"}}]}""");await Task.Delay(100);
        sent.Clear();await core.ExecuteScriptAsync("document.querySelector('.plan-card button').click()");await Task.Delay(100);
        if(!sent.Exists(message=>message.Contains("\"action\":\"proceedPlan\"")))throw new Exception("Plan action did not reach host");
        core.PostWebMessageAsJson("""{"type":"operationError","action":"proceedPlan","message":"Plan changed after preview"}""");await Task.Delay(100);
        await Check(core,"document.querySelector('.plan-card .card-status').textContent === 'Plan changed after preview' && Array.from(document.querySelectorAll('.plan-card button')).every(b=>!b.disabled)","plan failure displays error and restores original card actions");
        core.PostWebMessageAsJson("""{"type":"session","sessionId":"timeline","messageRestoreEnabled":true,"transcript":[{"role":"user","text":"before message","seq":1}]}""");await Task.Delay(100);
        await Check(core,"document.querySelectorAll('.cp-btn').length === 2","message history restores original hover actions");
        sent.Clear();await core.ExecuteScriptAsync("document.querySelectorAll('.cp-btn')[1].click()");await Task.Delay(100);
        if(!sent.Exists(message=>message.Contains("\"action\":\"previewMessageRestore\"")&&message.Contains("\"branch\":true")))throw new Exception("Message branch did not preview");
        core.PostWebMessageAsJson("""{"type":"messageRestorePreview","data":{"messageRestoreId":"timeline-preview","revision":"revision","files":[],"reason":"Conversation snapshot; original preserved","diff":""}}""");await Task.Delay(100);
        await Check(core,"document.querySelector('.approval-card').textContent.includes('original preserved')","message restore requires original inline review");
        sent.Clear();await core.ExecuteScriptAsync("document.querySelector('.approval-card button').click()");await Task.Delay(100);
        if(!sent.Exists(message=>message.Contains("\"action\":\"restoreMessage\"")&&message.Contains("timeline-preview")))throw new Exception("Message restore approval did not reach host");
        core.PostWebMessageAsJson("""{"type":"session","sessionId":"branch","messageRestoreEnabled":true,"transcript":[],"restoredDraft":"before message","restoreNotice":"Original preserved"}""");await Task.Delay(100);
        await Check(core,"document.getElementById('input').value === 'before message' && !document.querySelector('.turn-user')","restore returns draft without submitting or retaining discarded turns");
        core.PostWebMessageAsJson("""{"type":"session","sessionId":"conditional","savedSessionId":"conditional-saved","ompControlsEnabled":true,"ompProfile":"native","btwEnabled":true}""");
        core.PostWebMessageAsJson("""{"type":"event","data":{"sessionId":"conditional","sequence":1,"kind":"omp_event","frame":{"type":"ui_event","event":{"t":"notice","level":"retry","text":"Deterministic provider retry fixture"}}}}""");
        await Task.Delay(100);
        await Check(core,"document.querySelectorAll('.retry-cancel').length===1","provider retry exposes the original cancel control");
        sent.Clear();await core.ExecuteScriptAsync("document.querySelector('.retry-cancel').click()");await Task.Delay(100);
        if(!sent.Exists(message=>message.Contains("\"command\":\"abort_retry\"")))throw new Exception("Retry cancellation did not reach the host");
        await Check(core,"!document.querySelector('.retry-cancel')","retry cancellation reaches native control once and removes the button");
        await Check(core, "smokeErrors.length === 0", "no JavaScript or CSP errors: " + await core.ExecuteScriptAsync("smokeErrors"));
        await core.ExecuteScriptAsync("document.getElementById('sheet').hidden=true;window.marker=42;ChatComposer.setInput('도킹 전 초안');");
    }
    private static async Task Check(CoreWebView2 core, string script, string name)
    {
        var result = await core.ExecuteScriptAsync(script);
        if (result != "true") throw new Exception(name + ": " + result);
        Console.WriteLine("PASS: " + name);
    }
}
