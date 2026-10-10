namespace PiAgent.Vsix;

internal static class EditorSuggestionValidity
{
    internal static bool IsCurrent(bool closed,bool composing,int sequence,int generation,bool sameSnapshot,bool sameCaret,bool sameDocument)=>
        !closed&&!composing&&sequence==generation&&sameSnapshot&&sameCaret&&sameDocument;
}
