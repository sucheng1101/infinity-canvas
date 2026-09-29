package mailer

import (
	"crypto/tls"
	"encoding/base64"
	"errors"
	"fmt"
	"net/smtp"
	"strings"

	"github.com/sucheng1101/infinity-canvas/server/internal/config"
)

type Mailer interface {
	Ready() bool
	SendTest(email string) error
	SendVerification(email, token string) error
	SendRegistrationCode(email, code string) error
	SendPasswordReset(email, token string) error
}

type SMTP struct {
	cfg config.Config
}

type loginAuth struct {
	username string
	password string
}

func (a *loginAuth) Start(*smtp.ServerInfo) (string, []byte, error) {
	return "LOGIN", []byte{}, nil
}

func (a *loginAuth) Next(challenge []byte, more bool) ([]byte, error) {
	if !more {
		return nil, nil
	}
	value := strings.TrimSpace(string(challenge))
	if decoded, err := base64.StdEncoding.DecodeString(value); err == nil {
		value = strings.TrimSpace(string(decoded))
	}
	switch strings.ToLower(value) {
	case "username:", "user name:", "user":
		return []byte(a.username), nil
	case "password:", "pass":
		return []byte(a.password), nil
	default:
		return nil, errors.New("unknown SMTP AUTH LOGIN challenge")
	}
}

func (m *SMTP) auth() smtp.Auth {
	if m.cfg.SMTPUsername == "" {
		return nil
	}
	if m.cfg.SMTPForceAuthLogin {
		return &loginAuth{username: m.cfg.SMTPUsername, password: m.cfg.SMTPPassword}
	}
	return smtp.PlainAuth("", m.cfg.SMTPUsername, m.cfg.SMTPPassword, m.cfg.SMTPHost)
}

func NewSMTP(cfg config.Config) *SMTP { return &SMTP{cfg: cfg} }

func (m *SMTP) UpdateConfig(cfg config.Config) { m.cfg = cfg }

func (m *SMTP) Ready() bool {
	return !m.cfg.EmailEnabled || (m.cfg.SMTPHost != "" && m.cfg.SMTPFrom != "")
}

func (m *SMTP) SendTest(email string) error {
	return m.send(email, "无限画布 SMTP 测试邮件", "这是一封来自无限画布管理后台的测试邮件。\n\nSMTP 配置已生效。")
}

func (m *SMTP) SendVerification(email, token string) error {
	link := strings.TrimRight(m.cfg.PublicWebURL, "/") + "/verify-email?token=" + token
	return m.send(email, "验证无限画布账号", "请打开以下链接完成邮箱验证：\n\n"+link)
}

func (m *SMTP) SendRegistrationCode(email, code string) error {
	return m.send(email, "无限画布注册验证码", "你的注册验证码是："+code+"\n\n验证码 10 分钟内有效。")
}

func (m *SMTP) SendPasswordReset(email, token string) error {
	link := strings.TrimRight(m.cfg.PublicWebURL, "/") + "/reset-password?token=" + token
	return m.send(email, "重置无限画布密码", "请打开以下链接重置密码：\n\n"+link)
}

func (m *SMTP) send(to, subject, body string) error {
	if !m.cfg.EmailEnabled || m.cfg.SMTPHost == "" || m.cfg.SMTPFrom == "" {
		return nil
	}
	address := fmt.Sprintf("%s:%d", m.cfg.SMTPHost, m.cfg.SMTPPort)
	message := []byte("From: " + m.cfg.SMTPFrom + "\r\n" +
		"To: " + to + "\r\n" +
		"Subject: " + subject + "\r\n" +
		"Content-Type: text/plain; charset=UTF-8\r\n\r\n" + body)
	if m.cfg.SMTPPort == 465 || m.cfg.SMTPSSLEnabled {
		conn, err := tls.Dial("tcp", address, &tls.Config{ServerName: m.cfg.SMTPHost, MinVersion: tls.VersionTLS12})
		if err != nil {
			return err
		}
		client, err := smtp.NewClient(conn, m.cfg.SMTPHost)
		if err != nil {
			return err
		}
		defer client.Close()
		if auth := m.auth(); auth != nil {
			if err := client.Auth(auth); err != nil {
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
	return smtp.SendMail(address, m.auth(), m.cfg.SMTPFrom, []string{to}, message)
}
