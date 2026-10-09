using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Text.RegularExpressions;
using System.Xml;
using System.Xml.Linq;
using Newtonsoft.Json.Linq;

namespace PiAgent.Vsix;

internal static class XamlStructureEdits
{
    internal static readonly string[] Types={"Button","TextBlock","TextBox","CheckBox","ComboBox","ListBox","Border","Grid","StackPanel","Canvas","DockPanel","WrapPanel"};
    private sealed class Span { internal int Start,TagEnd,Close,End;internal string Name="";internal bool Empty; }
    internal static string Prepare(string source,JObject args)
    {
        using var reader=XmlReader.Create(new StringReader(source),new XmlReaderSettings{DtdProcessing=DtdProcessing.Prohibit,XmlResolver=null,MaxCharactersInDocument=1024*1024});var xml=XDocument.Load(reader,LoadOptions.PreserveWhitespace);
        var elements=xml.Root!.DescendantsAndSelf().ToArray();var spans=Spans(source);if(spans.Count!=elements.Length)throw new IOException("XAML source mapping could not be verified");
        var operation=(string?)args["changeOperation"];
        if(operation=="createComponent"){
            var parentId=(string?)args["parent"]??"0";if(!int.TryParse(parentId,out var parent)||parent<0||parent>=elements.Length)throw new IOException("XAML parent is unavailable");
            if(!new[]{"Grid","StackPanel","Canvas","DockPanel","WrapPanel"}.Contains(elements[parent].Name.LocalName))throw new IOException("Only panel elements accept structural children");
            var type=(string?)args["type"]??"";if(!Types.Contains(type))throw new IOException("Select an advertised standard XAML element type");
            var name=(string?)args["name"]??"";if(!Regex.IsMatch(name,"^[A-Za-z_][A-Za-z_0-9]{0,127}$"))throw new IOException("A valid new XAML name is required");
            XNamespace x="http://schemas.microsoft.com/winfx/2006/xaml";
            if(elements.Any(e=>(string?)e.Attribute(x+"Name")==name||(string?)e.Attribute("Name")==name))throw new IOException("XAML name already exists");
            var xPrefix=xml.Root.GetPrefixOfNamespace(x);if(string.IsNullOrEmpty(xPrefix))throw new IOException("Declare an XAML language namespace before adding named elements");
            var prefix=spans[parent].Name.Contains(":")?spans[parent].Name.Substring(0,spans[parent].Name.IndexOf(':')+1):"";
            var node="<"+prefix+type+" "+xPrefix+":Name=\""+name+"\"";
            foreach(var field in new[]{"width","height"})if(args[field]!=null){var value=(int)args[field]!;if(value<1||value>32767)throw new IOException("Invalid element size");node+=" "+(field=="width"?"Width":"Height")+"=\""+value.ToString(CultureInfo.InvariantCulture)+"\"";}
            if(elements[parent].Name.LocalName=="Canvas")foreach(var field in new[]{"x","y"})if(args[field]!=null){var value=(int)args[field]!;if(value< -32768||value>32767)throw new IOException("Invalid element position");node+=" Canvas."+(field=="x"?"Left":"Top")+"=\""+value.ToString(CultureInfo.InvariantCulture)+"\"";}
            node+=" />";var newline=source.Contains("\r\n")?"\r\n":"\n";
            if(spans[parent].Empty){var tag=source.Substring(spans[parent].Start,spans[parent].TagEnd-spans[parent].Start);var slash=tag.LastIndexOf('/');var replacement=tag.Remove(slash,1)+newline+"  "+node+newline+"</"+spans[parent].Name+">";return source.Remove(spans[parent].Start,tag.Length).Insert(spans[parent].Start,replacement);}
            return source.Insert(spans[parent].Close,newline+"  "+node+newline);
        }
        var component=(string?)args["component"]??"";if(!int.TryParse(component,out var index)||index<=0||index>=elements.Length)throw new IOException("Select an existing child XAML element");
        if(operation=="deleteComponent"){
            if(elements[index].Elements().Any())throw new IOException("Delete only a leaf XAML element; nested layout/resource deletion requires a separate review");
            var name=(string?)elements[index].Attribute(XName.Get("Name","http://schemas.microsoft.com/winfx/2006/xaml"))??(string?)elements[index].Attribute("Name");
            if(!string.IsNullOrEmpty(name)&&elements.Where((e,i)=>i!=index).SelectMany(e=>e.Attributes()).Any(a=>a.Value.Contains(name)))throw new IOException("Named element has possible binding/resource references; remove references first");
            return source.Remove(spans[index].Start,spans[index].End-spans[index].Start);
        }
        if(operation=="bindEvent"){
            var property=(string?)args["property"]??"";var method=(string?)args["eventMethod"]??"";
            if(!Events(elements[index].Name.LocalName).Contains(property)||!Regex.IsMatch(method,"^[A-Za-z_][A-Za-z_0-9]{0,127}$"))throw new IOException("Select a supported event and a valid handler name");
            if(elements[index].Attribute(property)!=null)throw new IOException("Event is already bound; inspect its existing handler first");
            var position=spans[index].TagEnd-1;if(spans[index].Empty){position--;while(position>spans[index].Start&&char.IsWhiteSpace(source[position]))position--;if(source[position]!='/')throw new IOException("XAML tag span changed");}
            return source.Insert(position," "+property+"=\""+method+"\" ");
        }
        throw new IOException("Unsupported structural XAML operation");
    }
    internal static string[] Events(string type) =>
        type == "Button" ? new[] { "Click", "Loaded" } :
        type == "TextBox" ? new[] { "TextChanged", "Loaded" } :
        type == "CheckBox" ? new[] { "Click", "Checked", "Unchecked", "Loaded" } :
        type == "ComboBox" || type == "ListBox" ? new[] { "SelectionChanged", "Loaded" } :
        Types.Contains(type) ? new[] { "Loaded" } : Array.Empty<string>();
    private static List<Span> Spans(string source)
    {
        var spans=new List<Span>();var stack=new Stack<Span>();var cursor=0;
        while((cursor=source.IndexOf('<',cursor))>=0){
            if(source.Substring(cursor).StartsWith("<!--",StringComparison.Ordinal)){var end=source.IndexOf("-->",cursor,StringComparison.Ordinal);if(end<0)throw new IOException("Invalid comment");cursor=end+3;continue;}
            if(source.Substring(cursor).StartsWith("<![CDATA[",StringComparison.Ordinal)){var end=source.IndexOf("]]>",cursor,StringComparison.Ordinal);if(end<0)throw new IOException("Invalid CDATA");cursor=end+3;continue;}
            if(source.Substring(cursor).StartsWith("<?",StringComparison.Ordinal)){var end=source.IndexOf("?>",cursor,StringComparison.Ordinal);if(end<0)throw new IOException("Invalid XML declaration");cursor=end+2;continue;}
            var endTag=cursor+1;char quote='\0';for(;endTag<source.Length;endTag++){var ch=source[endTag];if(quote!='\0'){if(ch==quote)quote='\0';}else if(ch=='\''||ch=='\"')quote=ch;else if(ch=='>')break;}
            if(endTag>=source.Length)throw new IOException("Invalid XML tag");
            if(source[cursor+1]=='/'){if(stack.Count==0)throw new IOException("Invalid XML hierarchy");var current=stack.Pop();current.Close=cursor;current.End=endTag+1;}
            else{
                var match=Regex.Match(source.Substring(cursor+1),"^[^\\s/>]+");if(!match.Success)throw new IOException("Invalid element name");
                var tail=endTag-1;while(char.IsWhiteSpace(source[tail]))tail--;var current=new Span{Start=cursor,Name=match.Value,TagEnd=endTag+1,Empty=source[tail]=='/'};spans.Add(current);
                if(current.Empty){current.Close=tail;current.End=endTag+1;}else stack.Push(current);
            }
            cursor=endTag+1;
        }
        if(stack.Count!=0)throw new IOException("Unclosed XAML hierarchy");return spans;
    }
}
