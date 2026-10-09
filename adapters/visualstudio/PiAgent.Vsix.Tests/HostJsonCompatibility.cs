using System;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;
using System.Reflection.Emit;

internal static class HostJsonCompatibility
{
    // Inspect real compiled call sites, including compiler-generated async state machines.
    // This catches another API mismatch without needing to execute every SDK/UI branch.
    internal static int Audit(Assembly callers, string hostPath)
    {
        // LoadFile preserves the host's distinct 13.0.3.0 identity alongside the
        // ordinary test reference. No host methods are invoked by this audit.
        var host = Assembly.LoadFile(System.IO.Path.GetFullPath(hostPath));
        var opcodes = typeof(OpCodes).GetFields(BindingFlags.Public | BindingFlags.Static)
            .Where(f => f.FieldType == typeof(OpCode)).Select(f => (OpCode)f.GetValue(null)!).ToDictionary(o => o.Value);
        var checkedMembers = new HashSet<string>(StringComparer.Ordinal);
        foreach (var type in callers.GetTypes()) {
            var methods = type.GetMethods(BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Instance | BindingFlags.Static | BindingFlags.DeclaredOnly).Cast<MethodBase>()
                .Concat(type.GetConstructors(BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Instance | BindingFlags.Static));
            foreach (var method in methods) {
                var bytes = method.GetMethodBody()?.GetILAsByteArray(); if (bytes == null) continue;
                for (var position = 0; position < bytes.Length;) {
                    var first = bytes[position++]; short value = first;
                    if (first == 0xfe) value = unchecked((short)(0xfe00 | bytes[position++]));
                    var opcode = opcodes[value];
                    if (opcode.OperandType == OperandType.InlineMethod) {
                        var referenced = method.Module.ResolveMethod(BitConverter.ToInt32(bytes, position), type.GetGenericArguments(), method.IsGenericMethod ? method.GetGenericArguments() : Type.EmptyTypes);
                        if (referenced?.DeclaringType?.Assembly.GetName().Name == "Newtonsoft.Json") {
                            if (referenced is MethodInfo generic && generic.IsGenericMethod) referenced = generic.GetGenericMethodDefinition();
                            var declaring = referenced.DeclaringType!; if (declaring.IsGenericType) declaring = declaring.GetGenericTypeDefinition();
                            var key = declaring.FullName + ":" + Signature(referenced);
                            if (checkedMembers.Add(key)) {
                                var equivalent = host.GetType(declaring.FullName!, true)!;
                                var candidates = equivalent.GetMethods(BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Instance | BindingFlags.Static).Cast<MethodBase>()
                                    .Concat(equivalent.GetConstructors(BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Instance | BindingFlags.Static));
                                if (!candidates.Any(candidate => Signature(candidate) == Signature(referenced)))
                                    throw new MissingMethodException("VS2022 host Newtonsoft API does not satisfy compiled reference " + key);
                            }
                        }
                    }
                    position += OperandSize(opcode.OperandType, bytes, position);
                }
            }
        }
        return checkedMembers.Count;
    }
    private static string Signature(MethodBase method) => method.Name + "`" + (method.IsGenericMethod ? method.GetGenericArguments().Length : 0) +
        "(" + string.Join(",", method.GetParameters().Select(p => TypeName(p.ParameterType))) + "):" + (method is MethodInfo info ? TypeName(info.ReturnType) : "ctor");
    private static string TypeName(Type type)
    {
        if (type.IsGenericParameter) return (type.DeclaringMethod == null ? "!" : "!!") + type.GenericParameterPosition;
        if (type.HasElementType) return TypeName(type.GetElementType()!) + (type.IsByRef ? "&" : type.IsPointer ? "*" : "[" + new string(',', type.GetArrayRank() - 1) + "]");
        return type.IsGenericType ? type.GetGenericTypeDefinition().FullName + "<" + string.Join(",", type.GetGenericArguments().Select(TypeName)) + ">" : type.FullName!;
    }
    private static int OperandSize(OperandType type, byte[] bytes, int position)
    {
        switch (type) {
            case OperandType.InlineNone: return 0;
            case OperandType.ShortInlineBrTarget: case OperandType.ShortInlineI: case OperandType.ShortInlineVar: return 1;
            case OperandType.InlineVar: return 2;
            case OperandType.InlineI8: case OperandType.InlineR: return 8;
            case OperandType.InlineSwitch: return 4 + BitConverter.ToInt32(bytes, position) * 4;
            default: return 4;
        }
    }
}
