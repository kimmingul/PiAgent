using System;
using System.ComponentModel.Composition;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Input;
using Microsoft.VisualStudio.ComponentModelHost;
using Microsoft.VisualStudio.Editor;
using Microsoft.VisualStudio.Language.Proposals;
using Microsoft.VisualStudio.Language.Suggestions;
using Microsoft.VisualStudio.Shell;
using Microsoft.VisualStudio.Shell.Interop;
using Microsoft.VisualStudio.Text;
using Microsoft.VisualStudio.Text.Editor;
using Microsoft.VisualStudio.Text.Operations;
using Microsoft.VisualStudio.TextManager.Interop;
using Microsoft.VisualStudio.Utilities;
using Newtonsoft.Json.Linq;
using PiAgent.Transport;

namespace PiAgent.Vsix;

[Export(typeof(IWpfTextViewCreationListener)),ContentType("code"),TextViewRole(PredefinedTextViewRoles.Document)]
internal sealed class EditorSuggestions : IWpfTextViewCreationListener
{
    [Import]internal ITextDocumentFactoryService Documents=null!;
    [Import]internal SuggestionServiceBase Suggestions=null!;
    [Import]internal ITextUndoHistoryRegistry Undo=null!;
    internal static readonly object StateKey=new object();
    public void TextViewCreated(IWpfTextView view)
    {
        if(Documents.TryGetTextDocument(view.TextBuffer,out var document)&&new[]{".cs",".vb",".cpp",".c",".h",".hpp",".xaml"}.Contains(Path.GetExtension(document.FilePath),StringComparer.OrdinalIgnoreCase))
            view.Properties.AddProperty(StateKey,new EditorState(view,document,Suggestions,Undo));
    }
    internal static async Task CommandAsync(string command,CancellationToken token)
    {
        await ThreadHelper.JoinableTaskFactory.SwitchToMainThreadAsync(token);
        var manager=Package.GetGlobalService(typeof(SVsTextManager)) as IVsTextManager;
        if(manager==null||manager.GetActiveView(1,null,out var adapter)!=0)return;
        var components=Package.GetGlobalService(typeof(SComponentModel)) as IComponentModel;
        var view=components?.GetService<IVsEditorAdaptersFactoryService>()?.GetWpfTextView(adapter);
        if(view==null||!view.Properties.TryGetProperty(StateKey,out EditorState state)){Status("PiAgent: Open a supported code editor / 지원하는 코드 편집기를 열어주세요.");return;}
        if(command=="accept"){view.VisualElement.Focus();state.Accept();}else if(command=="dismiss")state.Cancel();else await state.RequestAsync(command,true,token);
    }
    internal static void Status(string message){ThreadHelper.ThrowIfNotOnUIThread();(Package.GetGlobalService(typeof(SVsStatusbar)) as IVsStatusbar)?.SetText(message);}
}

internal sealed class EditorState : SuggestionProviderBase
{
    private readonly IWpfTextView view;
    private readonly ITextDocument document;
    private readonly SuggestionServiceBase service;
    private readonly ITextUndoHistoryRegistry undo;
    private readonly Microsoft.VisualStudio.Threading.JoinableTaskCollection jobs;
    private readonly Microsoft.VisualStudio.Threading.JoinableTaskFactory factory;
    private CancellationTokenSource? request;
    private SuggestionManagerBase? manager;
    private SuggestionSessionBase? session;
    private readonly Queue<JObject> edits=new Queue<JObject>();
    private bool closed,composing,enabled=true,accepting;
    private int generation;
    internal EditorState(IWpfTextView view,ITextDocument document,SuggestionServiceBase service,ITextUndoHistoryRegistry undo)
    {
        this.view=view;this.document=document;this.service=service;this.undo=undo;
        jobs=ThreadHelper.JoinableTaskContext.CreateCollection();factory=ThreadHelper.JoinableTaskContext.CreateFactory(jobs);
        view.TextBuffer.Changed+=Changed;view.Caret.PositionChanged+=Moved;view.Closed+=Closed;view.LostAggregateFocus+=LostFocus;
        TextCompositionManager.AddPreviewTextInputStartHandler(view.VisualElement,CompositionStarted);
        TextCompositionManager.AddPreviewTextInputHandler(view.VisualElement,CompositionFinished);
    }
    private void CompositionStarted(object sender,TextCompositionEventArgs args){composing=true;Cancel();}
    private void CompositionFinished(object sender,TextCompositionEventArgs args){composing=false;Schedule();}
    private void Changed(object sender,TextContentChangedEventArgs args)
    {
        foreach(var edit in args.Changes){edits.Enqueue(new JObject{["start"]=edit.OldPosition,["removed"]=edit.OldText.Substring(0,Math.Min(edit.OldText.Length,256)),["inserted"]=edit.NewText.Substring(0,Math.Min(edit.NewText.Length,256))});while(edits.Count>8)edits.Dequeue();}
        if(!accepting)Schedule();
    }
    private void Moved(object sender,CaretPositionChangedEventArgs args){if(!accepting&&session==null)Schedule();}
    // Moving into the Tools menu must not destroy a proposal before Accept can run.
    // The VS suggestion service owns proposal visibility on focus changes.
    private void LostFocus(object sender,EventArgs args){request?.Cancel();}
    private void Schedule()
    {
        Cancel();if(closed||composing||!enabled||!view.HasAggregateFocus||!EditorOptions.Current.AutomaticCompletion)return;
        factory.RunAsync(async()=>await RequestAsync("completion",false,CancellationToken.None)).FileAndForget("PiAgent/AutomaticCompletion");
    }
    internal void Cancel()
    {
        generation++;request?.Cancel();var shown=session;session=null;
        if(shown!=null)factory.RunAsync(async()=>await shown.DismissAsync(ReasonForDismiss.DismissedBySession,CancellationToken.None)).FileAndForget("PiAgent/DismissSuggestion");
    }
    private void Closed(object sender,EventArgs args)
    {
        closed=true;Cancel();view.TextBuffer.Changed-=Changed;view.Caret.PositionChanged-=Moved;view.Closed-=Closed;view.LostAggregateFocus-=LostFocus;
        TextCompositionManager.RemovePreviewTextInputStartHandler(view.VisualElement,CompositionStarted);
        TextCompositionManager.RemovePreviewTextInputHandler(view.VisualElement,CompositionFinished);
        if(manager!=null)factory.RunAsync(async()=>await manager.DisposeAsync()).FileAndForget("PiAgent/CloseSuggestionProvider");
        jobs.JoinTillEmptyAsync().FileAndForget("PiAgent/EditorShutdown");
    }
    public override Task DisabledAsync(CancellationToken cancellationToken){enabled=false;Cancel();return Task.CompletedTask;}
    public override Task EnabledAsync(CancellationToken cancellationToken){enabled=true;return Task.CompletedTask;}
    internal void Accept(){session?.CommitSuggestion(false);}
    internal async Task RequestAsync(string mode,bool manual,CancellationToken external)
    {
        await ThreadHelper.JoinableTaskFactory.SwitchToMainThreadAsync(external);
        if(manual)view.VisualElement.Focus();
        Cancel();if(closed||composing||!enabled)return;
        var sequence=generation;
        using var cancellation=CancellationTokenSource.CreateLinkedTokenSource(external);request=cancellation;
        try{
            if(!manual)await Task.Delay(EditorOptions.Current.DelayMilliseconds,cancellation.Token);
            await ThreadHelper.JoinableTaskFactory.SwitchToMainThreadAsync(cancellation.Token);
            if(closed||sequence!=generation||composing||!view.Selection.IsEmpty||!manual&&!view.HasAggregateFocus)return;
            var dte=Package.GetGlobalService(typeof(EnvDTE.DTE)) as EnvDTE.DTE;
            var solution=dte?.Solution.FullName;if(string.IsNullOrEmpty(solution)||!File.Exists(solution))throw new IOException("Open a saved solution / 저장된 솔루션을 열어주세요.");
            var root=Path.GetDirectoryName(solution)!;var workspace=new Uri(root+Path.DirectorySeparatorChar).AbsoluteUri;
            var file=IdeTools.ResolveFile(workspace,document.FilePath);
            var snapshot=view.TextSnapshot;var position=view.Caret.Position.BufferPosition;
            if(position.Snapshot!=snapshot||snapshot.Length>65536)throw new IOException("Editor context exceeds 64 KiB / 편집 문맥이 64 KiB를 초과합니다.");
            var text=snapshot.GetText();if(Encoding.UTF8.GetByteCount(text)>65536)throw new IOException("Editor context exceeds 64 KiB / 편집 문맥이 64 KiB를 초과합니다.");
            var options=EditorOptions.Current;
            if(string.IsNullOrWhiteSpace(options.Provider)!=string.IsNullOrWhiteSpace(options.Model))throw new IOException("Set both provider and model, or leave both empty / 제공자와 모델을 함께 지정하거나 함께 비워주세요.");
            var parameters=new JObject{["requestId"]=Guid.NewGuid().ToString("N"),["workspaceUri"]=workspace,["file"]=file.Substring(root.Length+1).Replace('\\','/'),["text"]=text,["position"]=position.Position,["mode"]=mode,["recentEdits"]=new JArray(edits.Select(x=>x.DeepClone()))};
            if(!string.IsNullOrWhiteSpace(options.Provider)){parameters["provider"]=options.Provider;parameters["model"]=options.Model;}
            if(manual)EditorSuggestions.Status("PiAgent: Generating suggestion… / 코드 제안 생성 중…");
            var pipe=Environment.GetEnvironmentVariable("PIAGENT_PIPE_NAME")??"piagent-dev";
            await CoreRuntime.EnsureRunningAsync(pipe,cancellation.Token);
            JObject result;
            using(var client=new PipeAdapterClient(pipe)){
                var hello=await client.InitializeAsync("visual-studio","editor",Guid.NewGuid().ToString("N"),cancellation.Token,chat:true,editorSuggestions:true);
                if(!(hello["capabilities"] as JArray)!.Values<string>().Contains("editor.suggestions.v1"))throw new IOException("Update PiAgent Core for editor suggestions / 코드 제안을 사용하려면 Core를 업데이트하세요.");
                result=await client.RequestAsync("editor.suggest",parameters,cancellation.Token);
            }
            await ThreadHelper.JoinableTaskFactory.SwitchToMainThreadAsync(cancellation.Token);
            if(closed||sequence!=generation||view.TextSnapshot!=snapshot||view.Caret.Position.BufferPosition!=position||composing)return;
            if((string?)result["requestId"]!=(string?)parameters["requestId"]||(string?)result["revision"]!=Revision(text))throw new IOException("Stale editor suggestion");
            if((bool?)result["empty"]==true){if(manual)EditorSuggestions.Status("PiAgent: No suggestion / 제안 없음");return;}
            var start=(int?)result["start"]??-1;var length=(int?)result["length"]??-1;var replacement=(string?)result["text"]??throw new IOException("Invalid suggestion text");
            if(start<0||length<0||start>snapshot.Length-length||mode=="completion"&&(start!=position.Position||length!=0))throw new IOException("Invalid suggestion range");
            manager??=await service.TryRegisterProviderAsync(this,view,"PiAgent",cancellation.Token);
            if(manager==null)throw new IOException("Visual Studio suggestions are unavailable in this view");
            var proposal=Proposal.TryCreateProposal("PiAgent",new[]{new ProposedEdit(new SnapshotSpan(snapshot,start,length),replacement)},new VirtualSnapshotPoint(position),null,ProposalFlags.DisableInIntelliSense|ProposalFlags.SingleTabToAccept,()=>Commit(snapshot,start,length,replacement),Guid.NewGuid().ToString("N"),null,null,null);
            if(proposal==null)throw new IOException("Visual Studio rejected this suggestion range");
            var suggestion=new AiSuggestion(mode=="next-edit",()=>{if(sequence==generation)Accepted(mode);},()=>{if(sequence==generation)session=null;});
            session=await manager.TryDisplaySuggestionAsync(suggestion,cancellation.Token);
            if(session!=null)await session.DisplayProposalAsync(proposal,cancellation.Token);
            if(manual)EditorSuggestions.Status(session==null?"PiAgent: Another suggestion provider is active / 다른 제안 공급자가 활성화되어 있습니다.":"PiAgent: Review suggestion, Tab to accept / 제안을 확인하고 Tab으로 수락하세요.");
        }catch(OperationCanceledException){}catch(Exception error){await ThreadHelper.JoinableTaskFactory.SwitchToMainThreadAsync();if(manual&&!closed)EditorSuggestions.Status("PiAgent: "+error.Message);}
        finally{if(ReferenceEquals(request,cancellation))request=null;}
    }
    private bool Commit(ITextSnapshot snapshot,int start,int length,string replacement)
    {
        ThreadHelper.ThrowIfNotOnUIThread();if(closed||composing||view.TextSnapshot!=snapshot)return false;
        if(!undo.TryGetHistory(view.TextBuffer,out var history))history=undo.RegisterHistory(view.TextBuffer);
        accepting=true;
        try{using var transaction=history.CreateTransaction("PiAgent suggestion / 코드 제안");using var edit=view.TextBuffer.CreateEdit();if(!edit.Replace(new Span(start,length),replacement)){transaction.Cancel();return false;}edit.Apply();if(edit.Canceled){transaction.Cancel();return false;}transaction.Complete();view.Caret.MoveTo(new SnapshotPoint(view.TextSnapshot,start+replacement.Length));return true;}
        finally{accepting=false;}
    }
    private void Accepted(string mode){session=null;if(mode=="completion"&&EditorOptions.Current.AutomaticNextEdit&&!closed)factory.RunAsync(async()=>await RequestAsync("next-edit",false,CancellationToken.None)).FileAndForget("PiAgent/NextEdit");}
    internal static string Revision(string text){using var hash=SHA256.Create();return BitConverter.ToString(hash.ComputeHash(Encoding.UTF8.GetBytes(text))).Replace("-","").ToLowerInvariant();}
}

internal sealed class AiSuggestion : SuggestionBase
{
    private readonly bool next;
    private readonly Action accepted,dismissed;
    internal AiSuggestion(bool next,Action accepted,Action dismissed){this.next=next;this.accepted=accepted;this.dismissed=dismissed;}
    public override EditDisplayStyle EditStyle=>next?EditDisplayStyle.MarkersOnlyThenGrayText:EditDisplayStyle.GrayText;
    public override TipStyle TipStyle=>TipStyle.AlwaysShowTip|TipStyle.TipAnchoredPlacement;
    public override bool HasMultipleSuggestions=>false;
    public override event System.ComponentModel.PropertyChangedEventHandler? PropertyChanged {add{} remove{}}
    public override Task OnChangeProposalAsync(SuggestionSessionBase session,ProposalBase proposal,ProposalBase originalProposal,bool nextProposal,CancellationToken token)=>Task.CompletedTask;
    public override async Task OnProposalUpdatedAsync(SuggestionSessionBase session,ProposalBase? proposal,ProposalBase? originalProposal,ReasonForUpdate reason,VirtualSnapshotPoint caret,CompletionState? completionState,CancellationToken token){if(reason==ReasonForUpdate.UpdatedAfterCaretMove&&proposal!=null)return;await session.DismissAsync(ReasonForDismiss.DismissedAfterBufferChange,token);dismissed();}
    public override Task OnAcceptedAsync(SuggestionSessionBase session,ProposalBase proposal,ProposalBase originalProposal,ReasonForAccept reason,CancellationToken token){accepted();return Task.CompletedTask;}
    public override Task OnDismissedAsync(SuggestionSessionBase session,ProposalBase? proposal,ProposalBase? originalProposal,ReasonForDismiss reason,CancellationToken token){dismissed();return Task.CompletedTask;}
}
