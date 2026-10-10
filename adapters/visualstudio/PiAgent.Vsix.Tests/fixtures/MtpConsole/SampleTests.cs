using System;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace PiAgent.MtpFixture;

[TestClass]
public sealed class SampleTests
{
    [TestMethod]
    public void UnicodeName() => Assert.AreEqual("한글 🚀", Environment.GetEnvironmentVariable("PIAGENT_MTP_TEXT") ?? "한글 🚀");

    [TestMethod]
    public void SecondTest() => Assert.AreNotEqual("fail", Environment.GetEnvironmentVariable("PIAGENT_MTP_MODE"));
}
