"""합성 RSS/HTML로 기사 수집과 근거 기반 분류를 검사합니다. 실제 네트워크는 사용하지 않습니다."""
import copy
import json
import unittest
from http.client import IncompleteRead
from unittest.mock import patch
from urllib.request import Request
from xml.etree import ElementTree

from flask import Flask
from home import bp
from home import news_content as content
from home import news_search as news
from home.tests.test_news_impact import article, OPPORTUNITY, RISK


class NewsContentTest(unittest.TestCase):
    def setUp(self):
        content._BODY_CACHE.clear()
        content._RESOLVE_CACHE.clear()

    def test_publisher_and_title_are_not_article_evidence(self):
        publisher = "DEMO very long publisher name " * 5
        self.assertFalse(content.usable_summary(publisher, "DEMO title", publisher))
        self.assertFalse(content.usable_summary(RISK, RISK, "DEMO publisher"))
        self.assertTrue(content.usable_summary("Demand grows for packaged desserts."))

    def test_semantic_body_excludes_navigation_related_and_scripts(self):
        parser = content.ArticleDocument()
        parser.feed('<main><nav>DEMO import ban recall</nav><article><h1>DEMO market report</h1><p>' + OPPORTUNITY + '</p><aside>DEMO food import ban</aside><div class="related-news">DEMO food recall</div><script>DEMO food recall</script></article></main>')
        text, source = parser.content()
        self.assertEqual(source, "article_body")
        self.assertIn(OPPORTUNITY, text)
        self.assertNotIn("recall", text)
        self.assertNotIn("import ban", text)

    def test_jsonld_and_meta_summary(self):
        parser = content.ArticleDocument()
        parser.feed('<script type="application/ld+json">' + json.dumps({'@graph': [{'@type': 'NewsArticle', 'articleBody': OPPORTUNITY}]}) + '</script>')
        self.assertEqual(parser.content(), (OPPORTUNITY, "article_body"))
        parser = content.ArticleDocument()
        parser.feed('<meta property="og:description" content="Vietnam food demand grows for local dessert retailers."><nav>DEMO import ban</nav>')
        self.assertEqual(parser.content()[1], "publisher_summary")
        self.assertNotIn("import ban", parser.content()[0])

    def test_cli_text_interface_preserved(self):
        parser = content.ArticleText()
        parser.feed('<p>DEMO tiếng Việt</p><script>secret demo script</script><style>hidden</style>')
        self.assertEqual(parser.parts, ['DEMO tiếng Việt'])

    def test_only_supported_https_publishers_are_fetched(self):
        for url in ['http://tuoitre.vn/story', 'https://127.0.0.1/story', 'https://localhost/story', 'https://tuoitre.vn.evil.test/story', 'https://tuoitre.vn:444/story', 'https://user:pass@tuoitre.vn/story', 'https://[::1]/story']:
            with self.subTest(url=url), patch.object(content, '_download_article') as download:
                self.assertEqual(content.article_content(url)['state'], 'unsupported')
                download.assert_not_called()
        with self.assertRaises(ValueError):
            content._SafeRedirect().redirect_request(Request('https://tuoitre.vn/demo'), None, 302, '', {}, 'http://127.0.0.1/demo')

    def test_body_success_and_failure_are_cached(self):
        url = 'https://tuoitre.vn/demo-test.htm'
        with patch.object(content, '_download_article', return_value='<article><p>' + OPPORTUNITY + '</p></article>') as download:
            a = content.article_content(url)
            a['text'] = 'modified client copy'
            b = content.article_content(url)
            self.assertIn(OPPORTUNITY, b['text'])
            self.assertEqual(download.call_count, 1)
        content._BODY_CACHE.clear()
        with patch.object(content, '_download_article', side_effect=IncompleteRead(b'')) as download:
            self.assertEqual(content.article_content(url)['state'], 'unavailable')
            self.assertEqual(content.article_content(url)['state'], 'unavailable')
            self.assertEqual(download.call_count, 1)

    def test_google_batch_resolves_only_supported_publishers_and_caches(self):
        google = 'https://news.google.com/rss/articles/DEMO_123'
        reply = [["wrb.fr", "Fbv4je", json.dumps(["garturlres", "https://tuoitre.vn/demo-test.htm"]), None, "0"]]
        with patch.object(content, '_google_request', side_effect=['<div data-n-a-sg="demo-signature" data-n-a-ts="12345"></div>', ")]}'\n\n" + json.dumps(reply)]) as request:
            self.assertEqual(content.resolve_google_urls([google])[google], 'https://tuoitre.vn/demo-test.htm')
            self.assertEqual(content.resolve_google_urls([google])[google], 'https://tuoitre.vn/demo-test.htm')
            self.assertEqual(request.call_count, 2)
            sent = request.call_args.args[1]
            self.assertIn(b'f.req=', sent)
        content._RESOLVE_CACHE.clear()
        reply[0][2] = json.dumps(['garturlres', 'https://127.0.0.1/private'])
        with patch.object(content, '_google_request', side_effect=['<div data-n-a-sg="demo" data-n-a-ts="123"></div>', json.dumps(reply)]):
            self.assertEqual(content.resolve_google_urls([google]), {})

    def test_malformed_google_link_and_transport_failure(self):
        with patch.object(content, '_google_request') as request:
            self.assertIsNone(content._google_signature('https://news.google.com.evil.test/rss/articles/DEMO'))
            request.assert_not_called()
        with patch.object(content, '_google_request', side_effect=TimeoutError):
            self.assertEqual(content.resolve_google_urls(['https://news.google.com/rss/articles/DEMO']), {})

    def test_prepare_preserves_original_fields_and_uses_real_body(self):
        row = article('DEMO test publisher', title='Vietnam food and dessert market', url='https://news.google.com/rss/articles/DEMO')
        before = copy.deepcopy(row)
        body = {'state': 'ready', 'text': 'Demand grows for packaged desserts.', 'source': 'article_body', 'url': 'https://tuoitre.vn/demo-test.htm'}
        with patch.object(news, 'resolve_google_urls', return_value={row['url']: body['url']}), patch.object(news, 'article_content', return_value=body):
            prepared = news.prepare_articles([row])[0]
        self.assertEqual(row, before)
        for key in row:
            self.assertEqual(prepared[key], row[key])
        self.assertEqual(prepared['analysis']['source'], 'article_body')
        self.assertEqual(news.classify_article(prepared)['category'], 'opportunity')

    def test_good_rss_summary_does_not_fetch_body(self):
        row = article(OPPORTUNITY)
        with patch.object(news, 'article_content') as fetch, patch.object(news, 'resolve_google_urls', return_value={}):
            prepared = news.prepare_articles([row])[0]
            fetch.assert_not_called()
        self.assertEqual(prepared['analysis']['state'], 'ready')
        self.assertEqual(prepared['analysis']['source'], 'publisher_rss')

    def test_missing_google_body_is_hold_and_keeps_original_link(self):
        row = article('DEMO test publisher', url='https://news.google.com/rss/articles/DEMO')
        with patch.object(news, 'resolve_google_urls', return_value={}), patch.object(news, 'article_content', return_value={'state': 'unsupported', 'text': '', 'source': 'none', 'url': ''}):
            prepared = news.prepare_articles([row])[0]
        self.assertEqual(news.classify_article(prepared)['reason_code'], 'fetch_failed')
        self.assertEqual(prepared['url'], row['url'])
        self.assertEqual(prepared['verification_status'], 'unverified')

    def test_title_market_context_and_short_real_summary_are_used(self):
        result = news.classify_article(article('Demand grows for packaged desserts.', title='Vietnam food and dessert market'))
        self.assertEqual(result['category'], 'opportunity')
        self.assertEqual(result['version'], 'rules-v2-content')
        result = news.classify_article(article('Food labeling regulation requires preparation.', title='Vietnam dessert imports'))
        self.assertEqual(result['category'], 'caution')

    def test_unrelated_negative_sentence_does_not_override_evidence(self):
        result = news.classify_article(article(OPPORTUNITY + ' There is no parking near the venue.'))
        self.assertEqual(result['category'], 'opportunity')

    def test_tone_normalization_does_not_turn_editing_into_milk_or_prices_into_rice(self):
        self.assertFalse(news._has('sửa đổi thông tư', news._TOPICS['food']))
        self.assertFalse(news._has(news._normalize('Gold prices rise'), news._TOPICS['food']))
        self.assertFalse(news._has('bài viết về kinh tế', news._GEOGRAPHY))

    def test_vietnamese_value_growth_is_not_price_inflation(self):
        self.assertFalse(news._has('gia tăng giá trị', ('giá tăng',)))
        self.assertTrue(news._has('giá tăng', ('giá tăng',)))
        row = article('Gia tăng giá trị cho sản phẩm thực phẩm đóng gói.', title='Thực phẩm Việt mở rộng thị trường')
        self.assertEqual(news.classify_article(row)['category'], 'opportunity')

    def test_meat_yield_is_not_product_recall(self):
        row = article('Vietnam food retailers explain tỷ lệ thu hồi for meat portions.', title='Vietnam food market')
        result = news.classify_article(row)
        self.assertEqual((result['category'], result['reason_code']), ('hold', 'no_signal'))
        row['description'] = 'Vietnam food retailers announce thu hồi sản phẩm for packaged desserts.'
        self.assertEqual(news.classify_article(row)['category'], 'risk')

    def test_google_link_metadata_is_not_used_as_long_summary(self):
        row = article('DEMO newsroom publisher channel official edition', description_kind='link_metadata')
        self.assertEqual(news.classify_article(row)['category'], 'hold')
        self.assertEqual(news.classify_article(row)['reason_code'], 'insufficient')

    def test_duplicate_uses_publisher_summary_without_overwriting_provenance(self):
        google = article('DEMO test publisher', publisher_url='https://tuoitre.vn', url='https://news.google.com/rss/articles/DEMO')
        direct = {**google, 'description': OPPORTUNITY, 'source_label': 'DEMO publisher RSS', 'url': 'https://tuoitre.vn/demo-test.htm'}
        merged = news._merge([[google], [direct]])
        self.assertEqual(len(merged), 1)
        self.assertEqual(merged[0]['description'], google['description'])
        self.assertEqual(merged[0]['url'], google['url'])
        self.assertEqual(merged[0]['source_label'], google['source_label'])
        self.assertEqual(merged[0]['analysis_text'], OPPORTUNITY)

    def test_native_feed_partial_failure_preserves_available_summary(self):
        node = ElementTree.fromstring('<item><title>DEMO Vietnam food demand grows</title><link>https://tuoitre.vn/demo.htm</link><description>' + OPPORTUNITY + '</description><pubDate>Tue, 10 Nov 2026 08:00:00 GMT</pubDate></item>')
        def feed(url, bucket):
            if 'tuoitre.vn' in url:
                return [node]
            raise news.SourceUnavailable('DEMO unavailable')
        with patch.object(news, '_cached_native_feed', side_effect=feed):
            rows, failed = news._native('trend')
        self.assertEqual(len(rows), 1)
        self.assertEqual(failed, ['Thanh Niên'])

    def test_api_returns_evidence_metadata_not_full_body(self):
        app = Flask(__name__)
        app.register_blueprint(bp)
        row = article(OPPORTUNITY)
        with patch('home.routes.search', return_value=([row], [])), patch('home.routes.translate_titles', return_value=([row['title']], False)):
            response = app.test_client().get('/home/api/news/search?q=food')
        self.assertEqual(response.status_code, 200)
        item = response.json['items'][0]
        self.assertEqual(item['analysis']['state'], 'ready')
        self.assertGreater(item['analysis']['characters'], 0)
        self.assertNotIn('analysis_text', item)
        self.assertNotIn('content_summary', item)
        self.assertEqual(item['impact']['version'], 'rules-v2-content')
        self.assertEqual(item['verification_status'], 'unverified')
        self.assertEqual(response.headers['Cache-Control'], 'no-store')


if __name__ == '__main__':
    unittest.main()
