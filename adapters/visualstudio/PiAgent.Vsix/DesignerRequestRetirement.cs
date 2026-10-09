using System;
using System.Collections.Generic;

namespace PiAgent.Vsix;

/// <summary>Connection-local cancellation tombstones, read before UI dispatch.</summary>
internal sealed class DesignerRequestRetirement
{
    private readonly object sync = new object();
    private readonly HashSet<string> retired = new HashSet<string>(StringComparer.Ordinal);
    private readonly int limit;
    private bool closed;
    internal DesignerRequestRetirement(int limit = 512) { this.limit = limit; }
    private static string? Key(string? session, string? id) =>
        string.IsNullOrEmpty(session) || session!.Length > 128 || string.IsNullOrEmpty(id) || id!.Length > 128
            ? null : session + "\0" + id;
    internal bool Retire(string? session, string? id)
    {
        lock (sync) {
            var key = Key(session, id);
            if (closed || key == null) { closed = true; return false; }
            if (retired.Contains(key)) return true;
            // Never evict an ID while its UI callback could still be queued.
            if (retired.Count >= limit) { closed = true; return false; }
            retired.Add(key); return true;
        }
    }
    internal bool IsRetired(string? session, string? id)
    {
        lock (sync) { var key = Key(session, id); return closed || key == null || retired.Contains(key); }
    }
    internal bool TryBegin(string? session, string? id) => !IsRetired(session, id);
    internal void Close() { lock (sync) { closed = true; } }
}
