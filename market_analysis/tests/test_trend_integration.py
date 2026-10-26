"""Module integration checks. Shared DB providers are replaced only in this test process."""
import sys, types, unittest
from pathlib import Path
from unittest.mock import patch
from flask import Flask, jsonify, abort
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT))
sys.modules['market_analysis.models']=types.ModuleType('market_analysis.models')
from market_analysis import bp
from market_analysis.repositories.trend_repository import TrendRepository

def create_test_app():
    app=Flask(__name__,template_folder=str(ROOT/'platform_core/templates'))
    app.config['TESTING']=True
    from jinja2 import ChoiceLoader, DictLoader
    app.register_blueprint(bp)
    app.jinja_loader=ChoiceLoader([DictLoader({'platform_core/base.html':'<html><head>{% block head %}{% endblock %}</head><body>{% block content %}{% endblock %}{% block scripts %}{% endblock %}</body></html>'}),app.jinja_loader])
    return app

class IntegrationTests(unittest.TestCase):
    def setUp(self): self.client=create_test_app().test_client()
    def test_page_and_local_assets(self):
        page=self.client.get('/market_analysis/?country=VN&tab=trend')
        self.assertEqual(page.status_code,200)
        html=page.get_data(as_text=True)
        for id in ['ranking','category-trend','fruit-flavors','regions','seasonality','ad-trends']:
            self.assertIn('id="'+id+'"',html)
        self.assertIn('/market_analysis/api/countries/VN/trends',html)
        for file in ['js/trends.js','css/trends.css']:
            with self.client.get('/market_analysis/static/'+file) as response:
                self.assertEqual(response.status_code,200)
    def test_api(self):
        r=self.client.get('/market_analysis/api/countries/VN/trends')
        self.assertEqual(r.status_code,200)
        d=r.get_json()
        self.assertEqual(len(d['categories']),4)
        self.assertEqual(len(d['fruit_flavors']),10)
        self.assertEqual(len(d['seasonality']),len(TrendRepository().get_keywords('VN')['seasonality_themes'])+1)  # 주제 탭 + 과일 탭
        self.assertTrue(d['regions'])
        self.assertNotIn('api_key',r.get_data(as_text=True).lower())
    def test_unsupported_country(self):
        self.assertEqual(self.client.get('/market_analysis/api/countries/XX/trends').status_code,404)
    def test_broken_data(self):
        with patch.object(TrendRepository,'get_latest',side_effect=ValueError('bad json')):
            self.assertEqual(self.client.get('/market_analysis/api/countries/VN/trends').status_code,503)
    def test_other_tabs(self):
        for tab in ['competitor','culture','insight']:
            self.assertEqual(self.client.get('/market_analysis/?country=VN&tab='+tab).status_code,200)
    def test_legacy_dashboard_contract(self):
        data=self.client.get('/market_analysis/api/dashboard?country=VN').get_json()
        for key in ['trend','competitors','culture','readiness']: self.assertIn(key,data)

if __name__=='__main__': unittest.main()
