package mailer

import (
	"crypto/tls"
	"fmt"
	"net/smtp"
	"strings"

	"github.com/sucheng1101/infinity-canvas/server/internal/config"
)

type Mailer interface {
	Ready() bool
	SendVerification(email, token string) error
	SendPasswordReset(email, token string) error
}

type SMTP struct {
	cfg config.Config
}

func NewSMTP(cfg config.Config) *SMTP { return &SMTP{cfg: cfg} }

func (m *SMTP) Ready() bool { return m.cfg.SMTPHost != "" && m.cfg.SMTPFrom != "" }

func (m *SMTP) SendVerification(email, token string) error {
	link := strings.TrimRight(m.cfg.PublicWebURL, "/") + "/verify-email?token=" + token
	return m.send(email, "验证无限画布账号", "请打开以下链接完成邮箱验证：\n\n"+link)
}

func (m *SMTP) SendPasswordReset(email, token string) error {
	link := strings.TrimRight(m.cfg.PublicWebURL, "/") + "/reset-password?token=" + token
	return m.send(email, "重置无限画布密码", "请打开以下链接重置密码：\n\n"+link)
}

func (m *SMTP) send(to, subject, body string) error {
	if m.cfg.SMTPHost == "" || m.cfg.SMTPFrom == "" {
		return nil
	}
	address := fmt.Sprintf("%s:%d", m.cfg.SMTPHost, m.cfg.SMTPPort)
	message := []byte("From: " + m.cfg.SMTPFrom + "\r\n" +
		"To: " + to + "\r\n" +
		"Subject: " + subject + "\r\n" +
		"Content-Type: text/plain; charset=UTF-8\r\n\r\n" + body)
	if m.cfg.SMTPPort == 465 {
		conn, err := tls.Dial("tcp", address, &tls.Config{ServerName: m.cfg.SMTPHost, MinVersion: tls.VersionTLS12})
		if err != nil {
			return err
		}
		client, err := smtp.NewClient(conn, m.cfg.SMTPHost)
		if err != nil {
			return err
		}
		defer client.Close()
		if m.cfg.SMTPUsername != "" {
			if err := client.Auth(smtp.PlainAuth("", m.cfg.SMTPUsername, m.cfg.SMTPPassword, m.cfg.SMTPHost)); err != nil {
				return err
			}
		}
		if err := client.Mail(m.cfg.SMTPFrom); err != nil {
			return err
		}
		if err := client.Rcpt(to); err != nil {
			return err
		}
		writer, err := client.Data()
		if err != nil {
			return err
		}
		if _, err := writer.Write(message); err != nil {
			return err
		}
		return writer.Close()
	}
	var auth smtp.Auth
	if m.cfg.SMTPUsername != "" {
		auth = smtp.PlainAuth("", m.cfg.SMTPUsername, m.cfg.SMTPPassword, m.cfg.SMTPHost)
	}
	return smtp.SendMail(address, auth, m.cfg.SMTPFrom, []string{to}, message)
}
