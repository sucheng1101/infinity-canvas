package storage

import (
	"context"
	"fmt"
	"io"
	"strings"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/s3"
)

// s3Store talks to any S3-compatible service: MinIO, Cloudflare R2, Aliyun OSS,
// Tencent COS, Backblaze B2 or AWS S3. Only the endpoint and path style differ.
type s3Store struct {
	client     *s3.Client
	bucket     string
	publicBase string
}

type s3Options struct {
	Endpoint     string
	Region       string
	Bucket       string
	AccessKey    string
	SecretKey    string
	PublicBase   string
	UsePathStyle bool
}

func newS3(options s3Options) (Store, error) {
	endpoint := strings.TrimSpace(options.Endpoint)
	bucket := strings.TrimSpace(options.Bucket)
	if endpoint == "" || bucket == "" {
		return nil, fmt.Errorf("%w: S3_ENDPOINT and S3_BUCKET are required", ErrNotConfigured)
	}
	if options.AccessKey == "" || options.SecretKey == "" {
		return nil, fmt.Errorf("%w: S3_ACCESS_KEY and S3_SECRET_KEY are required", ErrNotConfigured)
	}
	region := strings.TrimSpace(options.Region)
	if region == "" {
		region = "auto"
	}
	cfg := aws.Config{
		Region:      region,
		Credentials: credentials.NewStaticCredentialsProvider(options.AccessKey, options.SecretKey, ""),
	}
	client := s3.NewFromConfig(cfg, func(o *s3.Options) {
		o.BaseEndpoint = aws.String(endpoint)
		o.UsePathStyle = options.UsePathStyle
	})
	base := strings.TrimRight(strings.TrimSpace(options.PublicBase), "/")
	if base == "" {
		base = strings.TrimRight(endpoint, "/") + "/" + bucket
	}
	return &s3Store{client: client, bucket: bucket, publicBase: base}, nil
}

func (s *s3Store) Driver() string { return "s3" }

func (s *s3Store) Put(ctx context.Context, key string, r io.Reader, size int64, contentType string) (string, error) {
	clean, err := NormalizeKey(key)
	if err != nil {
		return "", err
	}
	input := &s3.PutObjectInput{Bucket: aws.String(s.bucket), Key: aws.String(clean), Body: r}
	if contentType != "" {
		input.ContentType = aws.String(contentType)
	}
	if size > 0 {
		input.ContentLength = aws.Int64(size)
	}
	if _, err := s.client.PutObject(ctx, input); err != nil {
		return "", err
	}
	return s.URL(clean), nil
}

func (s *s3Store) Open(ctx context.Context, key string) (io.ReadCloser, error) {
	clean, err := NormalizeKey(key)
	if err != nil {
		return nil, err
	}
	out, err := s.client.GetObject(ctx, &s3.GetObjectInput{Bucket: aws.String(s.bucket), Key: aws.String(clean)})
	if err != nil {
		return nil, err
	}
	return out.Body, nil
}

func (s *s3Store) Delete(ctx context.Context, key string) error {
	clean, err := NormalizeKey(key)
	if err != nil {
		return err
	}
	_, err = s.client.DeleteObject(ctx, &s3.DeleteObjectInput{Bucket: aws.String(s.bucket), Key: aws.String(clean)})
	return err
}

func (s *s3Store) URL(key string) string {
	return strings.TrimRight(s.publicBase, "/") + "/" + strings.TrimLeft(key, "/")
}

func (s *s3Store) Health(ctx context.Context) error {
	_, err := s.client.HeadBucket(ctx, &s3.HeadBucketInput{Bucket: aws.String(s.bucket)})
	return err
}
