using System;
using System.ComponentModel;
using Microsoft.VisualStudio.Shell;

namespace PiAgent.Vsix;

public sealed class EditorOptions : DialogPage
{
    internal static EditorOptions Current {get;private set;}=new EditorOptions();
    [Category("Suggestions / 제안"),DisplayName("Automatic completion / 자동완성"),Description("Generate after a typing pause. Each request can incur provider charges. / 입력을 멈추면 제안합니다. 제공자 사용료가 발생할 수 있습니다."),DefaultValue(false)]
    public bool AutomaticCompletion {get;set;}
    [Category("Suggestions / 제안"),DisplayName("Next edit after acceptance / 수락 후 다음 수정 제안"),DefaultValue(false)]
    public bool AutomaticNextEdit {get;set;}
    private int delay=1000;
    [Category("Suggestions / 제안"),DisplayName("Typing pause (ms) / 입력 대기 시간"),DefaultValue(1000)]
    public int DelayMilliseconds {get=>delay;set{if(value<400||value>5000)throw new ArgumentOutOfRangeException(nameof(value),"400–5000 ms");delay=value;}}
    [Category("Model / 모델"),DisplayName("OMP provider / OMP 제공자"),Description("Leave provider and model empty to use OMP's configured default. / 제공자와 모델을 비우면 OMP 기본 모델을 사용합니다."),DefaultValue("")]
    public string Provider {get;set;}="";
    [Category("Model / 모델"),DisplayName("Completion model ID / 자동완성 모델 ID"),DefaultValue("")]
    public string Model {get;set;}="";
    public override void LoadSettingsFromStorage(){base.LoadSettingsFromStorage();Current=this;}
    public override void SaveSettingsToStorage(){base.SaveSettingsToStorage();Current=this;}
}
