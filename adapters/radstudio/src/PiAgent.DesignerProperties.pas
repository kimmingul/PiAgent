unit PiAgent.DesignerProperties;
interface
uses System.Classes, System.JSON, System.TypInfo;
procedure DescribeDesignerProperties(Item: TPersistent; Rows: TJSONArray; Writable: Boolean);
function ResolveDesignerProperty(Item: TPersistent; const Path: string; out Target: TPersistent): PPropInfo;
function SupportedColumnCaptionPath(const Path: string): Boolean;
implementation
uses System.SysUtils, System.Variants, System.RegularExpressions;
const ScalarKinds=[tkInteger,tkInt64,tkFloat,tkEnumeration,tkSet,tkString,tkLString,tkWString,tkUString];
function NestedAllowed(const Name: string): Boolean;
begin
  Result:=SameText(Name,'Font') or SameText(Name,'Margins') or SameText(Name,'Padding') or
    SameText(Name,'Constraints') or SameText(Name,'Position') or SameText(Name,'Size') or
    SameText(Name,'TextSettings') or SameText(Name,'Stroke') or SameText(Name,'Fill');
end;
function CollectionAllowed(const Name: string): Boolean;
begin
  Result:=SameText(Name,'Columns');
end;
function SupportedColumnCaptionPath(const Path: string): Boolean;
begin
  Result:=TRegEx.IsMatch(Path,'^Columns\[(?:[0-9]|[1-2][0-9]|3[0-1])\]\.Caption$');
end;
function CollectionItemAt(Instance: TPersistent; const Segment: string): TPersistent;
var OpenAt,Index: Integer; Prop: PPropInfo; Value: TObject; Name,IndexText: string;
begin
  Result:=nil; OpenAt:=Pos('[',Segment);
  if (OpenAt<2) or not Segment.EndsWith(']') then Exit;
  Name:=Copy(Segment,1,OpenAt-1);
  if not CollectionAllowed(Name) then Exit;
  IndexText:=Copy(Segment,OpenAt+1,Length(Segment)-OpenAt-1);
  if (IndexText='') or (Length(IndexText)>2) or not TryStrToInt(IndexText,Index) or
    (Index<0) or (Index>=32) then Exit;
  Prop:=GetPropInfo(Instance,Name);
  if (Prop=nil) or (Prop.PropType^.Kind<>tkClass) then Exit;
  Value:=GetObjectProp(Instance,Prop);
  if (Value is TCollection) and (Index<TCollection(Value).Count) then
    Result:=TCollection(Value).Items[Index];
end;
function ResolveDesignerProperty(Item: TPersistent; const Path: string; out Target: TPersistent): PPropInfo;
var Parts: TArray<string>; I: Integer; ObjectValue: TObject;
begin
  Result:=nil; Target:=Item; Parts:=Path.Split(['.']);
  if (Length(Parts)<1) or (Length(Parts)>3) then Exit;
  for I:=0 to Length(Parts)-2 do begin
    if Pos('[',Parts[I])>0 then begin
      Target:=CollectionItemAt(Target,Parts[I]);
      if Target=nil then Exit;
      Continue;
    end;
    if not NestedAllowed(Parts[I]) then Exit;
    Result:=GetPropInfo(Target,Parts[I]);
    if (Result=nil) or (Result.PropType^.Kind<>tkClass) then begin Result:=nil; Exit; end;
    ObjectValue:=GetObjectProp(Target,Result);
    if not (ObjectValue is TPersistent) or (ObjectValue is TComponent) then begin Result:=nil; Exit; end;
    Target:=TPersistent(ObjectValue);
  end;
  Result:=GetPropInfo(Target,Parts[High(Parts)]);
  if (Result=nil) or not (Result.PropType^.Kind in ScalarKinds) or
    ((Target is TComponent) and SameText(Parts[High(Parts)],'Name')) then Result:=nil;
end;
procedure DescribeDesignerProperties(Item: TPersistent; Rows: TJSONArray; Writable: Boolean);
  procedure Describe(Instance: TPersistent; const Prefix: string; Depth: Integer);
  var List: PPropList; Count,I,J: Integer; Prop: PPropInfo; Value,Name: string;
    Obj: TJSONObject; Options: TJSONArray; Kind: PTypeInfo; Data: PTypeData; Nested: TObject;
  begin
    Count:=GetPropList(Instance.ClassInfo,ScalarKinds+[tkClass],nil); GetMem(List,Count*SizeOf(Pointer));
    try
      GetPropList(Instance.ClassInfo,ScalarKinds+[tkClass],List);
      for I:=0 to Count-1 do begin
        if Rows.Count>=128 then Break; Prop:=List[I]; Name:=string(Prop.Name);
        if (Instance is TComponent) and SameText(Name,'Name') then Continue;
        try
          if Prop.PropType^.Kind=tkClass then begin
            if (Depth>=2) then Continue;
            if CollectionAllowed(Name) and (Depth=0) then begin
              Nested:=GetObjectProp(Instance,Prop);
              if Nested is TCollection then
                for J:=0 to TCollection(Nested).Count-1 do begin
                  if (J>=32) or (Rows.Count>=128) then Break;
                  Describe(TCollection(Nested).Items[J],Prefix+Name+'['+IntToStr(J)+'].',Depth+1);
                end;
              Continue;
            end;
            if not NestedAllowed(Name) then Continue;
            Nested:=GetObjectProp(Instance,Prop);
            if (Nested is TPersistent) and not (Nested is TComponent) then Describe(TPersistent(Nested),Prefix+Name+'.',Depth+1);
            Continue;
          end;
          Value:=VarToStr(GetPropValue(Instance,Name,True));
          Obj:=TJSONObject.Create.AddPair('name',Prefix+Name).AddPair('value',Copy(Value,1,4096))
            .AddPair('kind',GetEnumName(TypeInfo(TTypeKind),Ord(Prop.PropType^.Kind)))
            .AddPair('writable',TJSONBool.Create(Writable and not (Instance is TCollectionItem) and
              (Prop.SetProc<>nil) and (Length(Value)<=4096)));
          Rows.AddElement(Obj);
          Kind:=Prop.PropType^;
          if Kind.Kind=tkSet then Kind:=GetTypeData(Kind).CompType^;
          if Kind.Kind=tkEnumeration then begin
            Data:=GetTypeData(Kind); Options:=TJSONArray.Create; Obj.AddPair('options',Options);
            for J:=Data.MinValue to Data.MaxValue do begin
              if Options.Count>=64 then Break; Options.Add(GetEnumName(Kind,J));
            end;
          end;
        except end;
      end;
    finally FreeMem(List); end;
  end;
begin Describe(Item,'',0); end;
end.
