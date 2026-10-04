import {mkdir,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {existsSync} from 'node:fs';
const root=resolve(process.argv[2]??'artifacts/ide-acceptance-20261005');
if(existsSync(root))throw new Error('Choose a new acceptance directory; existing projects are never overwritten');
const save=async(path,text)=>writeFile(join(root,path),text.replace(/\r?\n/g,'\r\n'));
await mkdir(join(root,'vs'),{recursive:true});
await save('vs/PiAgentAcceptanceEditor.csproj',`<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><OutputType>WinExe</OutputType><TargetFramework>net10.0-windows</TargetFramework><Nullable>enable</Nullable><UseWindowsForms>true</UseWindowsForms><ImplicitUsings>enable</ImplicitUsings></PropertyGroup></Project>\n`);
await save('vs/Program.cs',`namespace PiAgentAcceptanceEditor;\nstatic class Program { [STAThread] static void Main() { ApplicationConfiguration.Initialize(); Application.Run(new Form1()); } }\n`);
await save('vs/Form1.cs',`namespace PiAgentAcceptanceEditor;\npublic partial class Form1 : Form { public Form1() { InitializeComponent(); } }\n`);
await save('vs/PiAgentAcceptance.sln',`Microsoft Visual Studio Solution File, Format Version 12.00
Project("{FAE04EC0-301F-11D3-BF4B-00C04F79EFBC}") = "PiAgentAcceptanceEditor", "PiAgentAcceptanceEditor.csproj", "{C3502FE8-01CD-4BFF-A526-4A59E31D2394}"
EndProject
Global
 GlobalSection(SolutionConfigurationPlatforms) = preSolution
  Debug|Any CPU = Debug|Any CPU
 EndGlobalSection
 GlobalSection(ProjectConfigurationPlatforms) = postSolution
  {C3502FE8-01CD-4BFF-A526-4A59E31D2394}.Debug|Any CPU.ActiveCfg = Debug|Any CPU
  {C3502FE8-01CD-4BFF-A526-4A59E31D2394}.Debug|Any CPU.Build.0 = Debug|Any CPU
 EndGlobalSection
EndGlobal
`);
await save('vs/Form1.Designer.cs',`#nullable enable
namespace PiAgentAcceptanceEditor;
partial class Form1 {
 private System.ComponentModel.IContainer? components=null;
 private MenuStrip mainMenu=null!;
 private ToolStrip tools=null!;
 private RichTextBox documentText=null!;
 private StatusStrip status=null!;
 private ToolStripMenuItem fileMenu=null!;
 private ToolStripMenuItem newMenu=null!;
 private ToolStripMenuItem openMenu=null!;
 private ToolStripMenuItem saveMenu=null!;
 private ToolStripButton newButton=null!;
 private ToolStripSeparator separator=null!;
 private ToolStripLabel documentLabel=null!;
 private ToolStripStatusLabel readyLabel=null!;
 protected override void Dispose(bool disposing){if(disposing)components?.Dispose();base.Dispose(disposing);}
 private void InitializeComponent(){
  components=new System.ComponentModel.Container();
  mainMenu=new MenuStrip();tools=new ToolStrip();documentText=new RichTextBox();status=new StatusStrip();
  SuspendLayout();
  fileMenu=new ToolStripMenuItem();newMenu=new ToolStripMenuItem();openMenu=new ToolStripMenuItem();saveMenu=new ToolStripMenuItem();
  newButton=new ToolStripButton();separator=new ToolStripSeparator();documentLabel=new ToolStripLabel();readyLabel=new ToolStripStatusLabel();
  fileMenu.Text="파일";newMenu.Text="새 문서";openMenu.Text="열기";saveMenu.Text="저장";
  fileMenu.DropDownItems.AddRange(new ToolStripItem[]{newMenu,openMenu,saveMenu});mainMenu.Items.AddRange(new ToolStripItem[]{fileMenu});
  newButton.Text="새 문서";documentLabel.Text="문서 편집";tools.Items.AddRange(new ToolStripItem[]{newButton,separator,documentLabel});
  tools.Dock=DockStyle.Top;mainMenu.Dock=DockStyle.Top;documentText.Dock=DockStyle.Fill;documentText.Text="검증용 문서";
  readyLabel.Text="준비";status.Items.AddRange(new ToolStripItem[]{readyLabel});status.Dock=DockStyle.Bottom;
  Controls.Add(documentText);Controls.Add(tools);Controls.Add(mainMenu);Controls.Add(status);
  MainMenuStrip=mainMenu;AutoScaleMode=AutoScaleMode.Font;ClientSize=new Size(800,450);Text="PiAgent Acceptance Editor";ResumeLayout(false);PerformLayout();
 }
}
`);
for(const framework of ['VCL','FMX']){
 const folder='rad-'+framework.toLowerCase();await mkdir(join(root,folder),{recursive:true});const isVcl=framework==='VCL';
 await save(folder+'/Acceptance.dpr',`program Acceptance;
uses ${isVcl?'Vcl':'FMX'}.Forms, Main in 'Main.pas' {EditorForm};
begin Application.Initialize;Application.CreateForm(TEditorForm,EditorForm);Application.Run;end.
`);
 await save(folder+'/Main.pas',`unit Main;
interface
uses System.Classes,${isVcl?'Vcl.Forms,Vcl.Controls,Vcl.StdCtrls,Vcl.ExtCtrls,Vcl.Menus,Vcl.ComCtrls':'FMX.Forms,FMX.Types,FMX.Controls,FMX.Memo,FMX.Menus,FMX.Layouts,FMX.ScrollBox'};
type TEditorForm=class(TForm)
 Menu: TMainMenu;FileMenu:TMenuItem;NewMenu:TMenuItem;OpenMenu:TMenuItem;SaveMenu:TMenuItem;
 ${isVcl?'TopPanel:TPanel;Status:TStatusBar;':'TopLayout:TLayout;'}DocumentMemo:TMemo;
 end;
var EditorForm:TEditorForm;
implementation
{$R *.${isVcl?'dfm':'fmx'}}
end.
`);
 await save(folder+'/Main.'+(isVcl?'dfm':'fmx'),isVcl?`object EditorForm: TEditorForm
  Caption = 'PiAgent VCL Acceptance Editor'
  ClientHeight = 450
  ClientWidth = 800
  Menu = Menu
  object TopPanel: TPanel
    Align = alTop
    Height = 36
    Caption = 'Document tools'
  end
  object DocumentMemo: TMemo
    Align = alClient
    ScrollBars = ssBoth
  end
  object Status: TStatusBar
    Align = alBottom
    Panels = <>
  end
  object Menu: TMainMenu
    object FileMenu: TMenuItem
      Caption = 'File'
      object NewMenu: TMenuItem
        Caption = 'New'
      end
      object OpenMenu: TMenuItem
        Caption = 'Open'
      end
      object SaveMenu: TMenuItem
        Caption = 'Save'
      end
    end
  end
end
`:`object EditorForm: TEditorForm
  Caption = 'PiAgent FMX Acceptance Editor'
  ClientHeight = 450
  ClientWidth = 800
  object TopLayout: TLayout
    Align = Top
    Size.Width = 800.000000000000000000
    Size.Height = 36.000000000000000000
  end
  object DocumentMemo: TMemo
    Align = Client
    Size.Width = 800.000000000000000000
    Size.Height = 414.000000000000000000
    TabOrder = 0
  end
  object Menu: TMainMenu
    object FileMenu: TMenuItem
      Text = 'File'
      object NewMenu: TMenuItem
        Text = 'New'
      end
      object OpenMenu: TMenuItem
        Text = 'Open'
      end
      object SaveMenu: TMenuItem
        Text = 'Save'
      end
    end
  end
end
`);
 await save(folder+'/Acceptance.dproj',`<Project xmlns="http://schemas.microsoft.com/developer/msbuild/2003">
 <PropertyGroup><ProjectGuid>{${isVcl?'D51C7220-C2A0-4EB0-A5BA-51495F8DD640':'D6F12549-D12C-4CEB-A228-311021E67071'}}</ProjectGuid><MainSource>Acceptance.dpr</MainSource><ProjectVersion>20.3</ProjectVersion><FrameworkType>${framework}</FrameworkType><Base>True</Base><AppType>Application</AppType><Config Condition="'$(Config)'==''">Debug</Config><Platform Condition="'$(Platform)'==''">Win64</Platform><TargetedPlatforms>2</TargetedPlatforms><DCC_DcuOutput>bin\\$(Platform)</DCC_DcuOutput><DCC_ExeOutput>bin\\$(Platform)</DCC_ExeOutput><DCC_Namespace>System;Winapi;${isVcl?'Vcl':'FMX'};$(DCC_Namespace)</DCC_Namespace></PropertyGroup>
 <ItemGroup><DelphiCompile Include="Acceptance.dpr"><MainSource>MainSource</MainSource></DelphiCompile><DCCReference Include="Main.pas"><Form>EditorForm</Form><FormType>${isVcl?'dfm':'fmx'}</FormType></DCCReference></ItemGroup>
 <ProjectExtensions><Borland.Personality>Delphi.Personality.12</Borland.Personality><Borland.ProjectType/><BorlandProject><Delphi.Personality><Source><Source Name="MainSource">Acceptance.dpr</Source></Source></Delphi.Personality><Platforms><Platform value="Win32">False</Platform><Platform value="Win64">True</Platform></Platforms></BorlandProject><ProjectFileVersion>12</ProjectFileVersion></ProjectExtensions>
 <Import Project="$(BDS)\\Bin\\CodeGear.Delphi.Targets"/>
</Project>
`);
}
for(const folder of ['vs','rad-vcl','rad-fmx']){
 await save(folder+'/.gitignore','bin/\nobj/\n*.local\n*.identcache\n*.dsk\n*.dcu\n*.res\n*.delphilsp.json\n__history/\n__recovery/\n.vs/\n');
 const cwd=join(root,folder),git=(...args)=>execFileSync('git',['-c','user.name=PiAgent Acceptance','-c','user.email=acceptance@localhost',...args],{cwd,windowsHide:true,stdio:'pipe'});
 git('init');git('add','.');git('commit','-m','Isolated native IDE acceptance fixture');
}
console.log(root);
