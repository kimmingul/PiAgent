using System;
using System.IO;
using Newtonsoft.Json.Linq;

namespace PiAgent.Vsix;

internal static class IdeAcceptanceFixtureGuard
{
    internal static JObject BuildTarget(JObject policy)
    {
        string Field(string name,string fallback) {
            var value=policy[name];if(value==null)return fallback;
            if(value.Type!=JTokenType.String)throw new IOException("Fixture "+name+" must be a string");
            var text=(string)value!;
            if(string.IsNullOrWhiteSpace(text)||text.Length>64||System.Linq.Enumerable.Any(text,char.IsControl))throw new IOException("Invalid fixture "+name);
            return text;
        }
        return new JObject{["operation"]="build",["project"]=policy["project"],["configuration"]=Field("configuration","Debug"),["platform"]=Field("platform","Any CPU")};
    }
    internal static JObject Validate(string? optIn, string? fixtureRoot, string solution, out string root, out string uri)
    {
        if (optIn != "1" || string.IsNullOrWhiteSpace(fixtureRoot) || !Path.IsPathRooted(fixtureRoot)) throw new IOException("Explicit fixture process opt-in and absolute root are required");
        root = Path.GetFullPath(fixtureRoot).TrimEnd(Path.DirectorySeparatorChar);
        if (root.Length <= Path.GetPathRoot(root).Length) throw new IOException("A drive root cannot be a destructive fixture");
        for (var ancestor = root; !string.IsNullOrEmpty(ancestor); ancestor = Path.GetDirectoryName(ancestor))
            if ((File.GetAttributes(ancestor) & FileAttributes.ReparsePoint) != 0) throw new IOException("Linked fixture ancestors are unsupported");
        uri = new Uri(root + Path.DirectorySeparatorChar).AbsoluteUri;
        if (!string.Equals(Path.GetDirectoryName(Path.GetFullPath(solution)), root, StringComparison.OrdinalIgnoreCase)) throw new IOException("Only the explicitly bound fixture solution directory is allowed");
        IdeTools.ResolveFile(uri, solution);
        var marker = IdeTools.ResolveFile(uri, "piagent-vs-acceptance.fixture.json");
        if (new FileInfo(marker).Length > 16 * 1024) throw new IOException("Fixture marker exceeds 16 KiB");
        var policy = JObject.Parse(File.ReadAllText(marker));
        if ((int?)policy["schemaVersion"] != 1 || (bool?)policy["destructiveFixture"] != true) throw new IOException("Dedicated destructive-fixture marker is required");
        BuildTarget(policy);
        return policy;
    }
}
