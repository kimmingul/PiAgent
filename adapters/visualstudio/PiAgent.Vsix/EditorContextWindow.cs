using System;
using System.IO;
using System.Text;

namespace PiAgent.Vsix;

internal static class EditorContextWindow
{
    internal static (int Start,string Text,int Position) Create(string text,int position)
    {
        if(position<0||position>text.Length||!Boundary(text,position))throw new IOException("Caret splits a Unicode character or is outside the buffer");
        // UTF-8 uses at most three bytes per UTF-16 unit. Keep both sides of the caret.
        var start=Math.Max(0,position-10500);var end=Math.Min(text.Length,position+10500);
        if(!Boundary(text,start))start++;if(!Boundary(text,end))end--;
        var body=text.Substring(start,end-start);
        if(Encoding.UTF8.GetByteCount(body)>65536)throw new IOException("Editor context exceeds 64 KiB");
        return(start,body,position-start);
    }
    private static bool Boundary(string text,int offset)=>offset==0||offset==text.Length||!char.IsHighSurrogate(text[offset-1])||!char.IsLowSurrogate(text[offset]);
}
