namespace Fixture.WinFormsFramework {
    partial class MainForm {
        private System.ComponentModel.IContainer components = null;
        protected override void Dispose(bool disposing) { if (disposing && components != null) components.Dispose(); base.Dispose(disposing); }
        private void InitializeComponent() {
            this.ExistingButton = new System.Windows.Forms.Button();
            this.SuspendLayout();
            this.ExistingButton.Name = "ExistingButton";
            this.ExistingButton.Text = "한글 Button";
            this.ExistingButton.Location = new System.Drawing.Point(20, 20);
            this.ExistingButton.Size = new System.Drawing.Size(120, 32);
            this.ClientSize = new System.Drawing.Size(420, 240);
            this.Controls.Add(this.ExistingButton);
            this.Name = "MainForm";
            this.Text = "PiAgent native designer fixture";
            this.ResumeLayout(false);
        }
        private System.Windows.Forms.Button ExistingButton;
    }
}
