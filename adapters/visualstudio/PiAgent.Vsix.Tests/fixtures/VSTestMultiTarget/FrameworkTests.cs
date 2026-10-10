using System;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace PiAgent.VSTestMultiTargetFixture;

[TestClass]
public sealed class FrameworkTests
{
    [TestMethod]
    public void FrameworkSpecific()
    {
#if NET9_0
        if (Environment.GetEnvironmentVariable("PIAGENT_VSTEST_FAIL_NET9") == "1")
            Assert.Fail("net9 repair target");
#endif
        Assert.IsTrue(System.IO.File.Exists(typeof(FrameworkTests).Assembly.Location));
    }
}
