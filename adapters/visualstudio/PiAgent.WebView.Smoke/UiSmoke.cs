using System;
using System.Threading.Tasks;
using Microsoft.Web.WebView2.Core;

internal static class UiSmoke
{
    internal static async Task Run(CoreWebView2 core)
    {
        // Exercise the shipped page and real browser/CSP, with deterministic host replies.
        for (int i = 0; i < 100; i++) {
            if (await core.ExecuteScriptAsync("document.documentElement.lang !== 'en' && !!window.piagentPost") == "true") break;
            await Task.Delay(50);
        }
        core.PostWebMessageAsJson("{\"type\":\"session\",\"sessionId\":\"smoke\",\"writeEnabled\":true,\"usageEnabled\":false,\"sessionsEnabled\":true,\"transcript\":[{\"role\":\"user\",\"text\":\"<script>bad()</script>\"},{\"role\":\"assistant\",\"text\":\"**원본 UI**\"}]}");
        await Task.Delay(150);
        await Check(core, "document.querySelector('.user-text').textContent === '<script>bad()</script>' && document.querySelector('.markdown-body strong').textContent === '원본 UI'", "history and Markdown");
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
