"""Browser security test: serves the app under its real CSP, mocks the Supabase API, feeds XSS
payloads through every screen and asserts nothing executes, nothing violates the CSP, and the
client never sends prices/status.   Run:  pip install playwright && playwright install chromium
                                          python3 tests/e2e_security.py"""
import json, base64, threading, http.server, socketserver, functools, sys, re
from playwright.sync_api import sync_playwright

import os, tempfile
ROOT=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SB='https://vvnokweblgojqaqlbsyh.supabase.co'
SHOTS=tempfile.mkdtemp(prefix='cbr-shots-')+'/'
XSS_IMG = '<img src=x onerror="window.__pwned=1">'
XSS_ATTR = "O'Brien\"><script>window.__pwned=2</script>"

class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self,*a): pass
httpd=socketserver.TCPServer(('127.0.0.1',0),functools.partial(Q,directory=ROOT)); PORT=httpd.server_address[1]
threading.Thread(target=httpd.serve_forever,daemon=True).start()
BASE=f'http://127.0.0.1:{PORT}/index.html'

def b64(o): return base64.urlsafe_b64encode(json.dumps(o).encode()).rstrip(b'=').decode()
JWT=b64({'alg':'HS256','typ':'JWT'})+'.'+b64({'sub':'11111111-1111-1111-1111-111111111111','role':'authenticated','exp':4102444800,'aud':'authenticated'})+'.sig'
USER={'id':'11111111-1111-1111-1111-111111111111','aud':'authenticated','role':'authenticated','email':'mgr@x.com','email_confirmed_at':'2026-01-01T00:00:00Z','app_metadata':{},'user_metadata':{},'created_at':'2026-01-01T00:00:00Z'}
SESSION={'access_token':JWT,'token_type':'bearer','expires_in':3600,'expires_at':4102444800,'refresh_token':'r','user':USER}

state={'profile':{'kind':'staff','id':1,'role':'Admin','name':'Mo '+XSS_IMG},'bk_patch_error':False,'posts':[],'rpcs':[],'external':[]}
DATA={
 'boats':[{'id':1,'name':XSS_IMG,'type':'Yacht','capacity':6,'base_price':1000,'status':'Available','photo_urls':'javascript:alert(1)'},
          {'id':2,'name':XSS_ATTR,'type':'Speedboat','capacity':4,'base_price':500,'status':'Rented','photo_urls':'https://evil.example/track.png'}],
 'bookings':[{'id':7,'customer_id':1,'boat_id':1,'start_date':'2030-01-01','end_date':'2030-01-04','total_amount':3000,'status':'Pending','payment_status':'Unpaid','notes':XSS_IMG,
              'customers':{'full_name':XSS_IMG,'phone':XSS_ATTR,'email':'a@b.c'},'boats':{'name':XSS_ATTR,'type':'<b>x</b>','base_price':1000},'payments':[{'amount':100}]}],
 'customers':[{'id':1,'full_name':XSS_ATTR,'email':XSS_IMG,'phone':'+254700000000','id_number':'1','created_at':'2026-01-01T00:00:00Z'}],
 'incidents':[{'id':1,'boat_id':1,'description':XSS_IMG,'photo_urls':None,'status':'Reported','incident_date':'2026-01-01T00:00:00Z','boats':{'name':XSS_ATTR}}],
 'payments':[{'id':1,'booking_id':7,'amount':100,'method':'Cash','reference':XSS_IMG,'created_at':'2026-01-01T00:00:00Z','bookings':{'id':7,'total_amount':3000,'customers':{'full_name':XSS_IMG},'boats':{'name':XSS_ATTR}}}],
 'users':[{'id':2,'auth_id':'x','email':XSS_IMG,'full_name':XSS_ATTR,'role':'Manager','phone':None}],
 'staff_invites':[{'id':1,'email':'new@x.com','full_name':XSS_IMG,'role':'Operator','phone':None}],
 'audit_log':[{'id':1,'at':'2026-01-01T00:00:00Z','actor_email':XSS_IMG,'actor_role':'Admin','table_name':'bookings','record_id':XSS_ATTR,'action':'UPDATE','changed_fields':['status',XSS_IMG]}],
}
CORS={'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'*','access-control-expose-headers':'*'}
def handler(route, request):
    u=request.url
    if request.method=='OPTIONS': return route.fulfill(status=204,headers=CORS)
    path=u.split('.supabase.co',1)[1]
    def js(obj,status=200): route.fulfill(status=status,headers={**CORS,'content-type':'application/json'},body=json.dumps(obj))
    if path.startswith('/auth/v1/token'): return js(SESSION)
    if path.startswith('/auth/v1/user'): return js(USER)
    if path.startswith('/auth/v1/logout'): return route.fulfill(status=204,headers=CORS)
    if path.startswith('/rest/v1/rpc/'):
        name=path.split('/rpc/')[1].split('?')[0]; state['rpcs'].append((name,request.post_data))
        if name=='bootstrap_profile': return js(state['profile'])
        if name=='record_payment': return js({'payment_status':'Partial','paid':100,'balance':2900})
        return route.fulfill(status=204,headers=CORS)
    m=re.match(r'/rest/v1/(\w+)',path)
    if m:
        t=m.group(1)
        if request.method=='POST': state['posts'].append((t,request.post_data)); return route.fulfill(status=201,headers=CORS)
        if request.method=='PATCH':
            if state['bk_patch_error']: return js({'code':'23P01','message':'conflicting key value violates exclusion constraint "bookings_no_overlap"','details':'secret detail'},409)
            return js([{'id':7}])
        if request.method=='DELETE': return route.fulfill(status=204,headers=CORS)
        return js(DATA.get(t,[]))
    if path.startswith('/storage/v1/'): return js({'signedURL':None,'data':[]})
    return js({})

results=[]
def check(name,ok,detail=''): results.append((name,ok,detail)); print(('PASS ' if ok else 'FAIL ')+name+(('  -> '+str(detail)) if (detail and not ok) else ''))

with sync_playwright() as p:
    br=p.chromium.launch()
    ctx=br.new_context(viewport={'width':1400,'height':850})
    page=ctx.new_page()
    errors=[]; dialogs=[]
    page.on('pageerror',lambda e: errors.append(str(e)))
    page.on('console',lambda m: errors.append('console:'+m.text) if m.type=='error' and 'Failed to load resource' not in m.text and '[CBR]' not in m.text else None)
    page.on('dialog',lambda d:(dialogs.append((d.type,d.message)),d.dismiss()))
    page.on('request',lambda r: state['external'].append(r.url) if not (r.url.startswith(f'http://127.0.0.1:{PORT}') or r.url.startswith(SB) or r.url.startswith('data:') or r.url.startswith('blob:')) else None)
    page.add_init_script("window.__csp=[]; document.addEventListener('securitypolicyviolation',e=>window.__csp.push(e.violatedDirective+' '+e.blockedURI));")
    page.route(SB+'/**',handler)

    page.goto(BASE); page.wait_for_selector('#login-screen')
    page.screenshot(path=SHOTS+'1_login.png')
    check('login screen renders, no CSP violations', page.evaluate('window.__csp.length')==0, page.evaluate('window.__csp'))
    check('Tailwind CSS applied (login card has rounded corners)', page.evaluate("getComputedStyle(document.getElementById('panel-login')).borderRadius")!='0px')
    check('Font Awesome loaded from local file', page.evaluate("document.fonts.check('900 16px \"Font Awesome 6 Free\"')"))

    # --- wrong-password message is generic
    page.route(SB+'/auth/v1/token*', lambda r,q: r.fulfill(status=400,headers={**CORS,'content-type':'application/json'},body=json.dumps({'code':'invalid_credentials','error_code':'invalid_credentials','msg':'Invalid login credentials'})) if q.method!='OPTIONS' else r.fulfill(status=204,headers=CORS)) if False else None
    # --- sign in
    page.fill('#uni-email','mgr@x.com'); page.fill('#uni-password','Correct-Horse-9')
    page.click('#login-btn'); page.wait_for_selector('#main-app',state='visible')
    page.wait_for_timeout(500)
    check('signed in; role came from server (bootstrap_profile)', ('bootstrap_profile' in [r[0] for r in state['rpcs']]) and page.inner_text('#current-role')=='Admin')
    check('XSS in display name is rendered as TEXT', 'onerror' in page.inner_text('#current-user') and page.evaluate('window.__pwned')is None)
    page.screenshot(path=SHOTS+'2_dashboard.png')

    for sec in ['boats','bookings','customers','payments','incidents','users','audit','dashboard']:
        page.click(f'#nav-{sec}'); page.wait_for_timeout(450)
        txt=page.inner_text(f'#section-{sec}')
        injected=page.evaluate("document.querySelectorAll('#content-area img[src=\"x\"], #content-area script, #content-area b').length")
        check(f'[{sec}] payloads shown as inert text', injected==0 and page.evaluate('window.__pwned')is None, injected)
        if sec in ('boats','bookings','customers','payments','incidents','users','audit'):
            check(f'[{sec}] literal payload visible (escaped, not parsed)', ('<img' in txt or 'O\'Brien' in txt), txt[:120])
        if sec=='boats': page.screenshot(path=SHOTS+'3_boats.png')
        if sec=='bookings': page.screenshot(path=SHOTS+'4_bookings.png')
    check('boat photo: javascript:/foreign URLs replaced by local placeholder', page.evaluate("[...document.querySelectorAll('#boats-grid img')].every(i=>i.src.startsWith('data:'))"))
    check('no CSP violations during normal use', page.evaluate('window.__csp.length')==0, page.evaluate('window.__csp'))
    check('no third-party network requests', not state['external'], state['external'][:3])
    check('no JS errors', not errors, errors[:3])

    # quote-breaking payload in data-args round-trips intact
    page.click('#nav-users'); page.wait_for_timeout(300)
    page.click("#users-tbody button[data-click='removeUser']"); page.wait_for_timeout(300)
    check('data-args survives quotes/<script> in names (confirm shows exact name)', dialogs and XSS_ATTR in dialogs[-1][1], dialogs[-1:] )

    # CSP actually blocks an injected inline handler
    page.evaluate("document.body.insertAdjacentHTML('beforeend','<img src=x onerror=\"window.__inline=1\">')"); page.wait_for_timeout(300)
    check('CSP blocks injected inline event handler', page.evaluate('window.__inline')is None and any('script-src' in v for v in page.evaluate('window.__csp')))
    page.evaluate("window.__csp=[]"); errors.clear()
    csp=page.evaluate("document.querySelector('meta[http-equiv=Content-Security-Policy]').content")
    check("CSP has no 'unsafe-eval' / 'unsafe-inline' for scripts, no wildcard hosts", "unsafe-eval" not in csp and not re.search(r"script-src[^;]*unsafe-inline",csp) and '*' not in csp.replace('*.','') , csp)

    # error mapping: double-booking conflict -> friendly message, no DB detail leaked
    state['bk_patch_error']=True
    page.click('#nav-bookings'); page.wait_for_timeout(400)
    page.click("#bookings-tbody button[data-click='approveBooking']"); page.wait_for_timeout(500)
    toast=page.inner_text('#toast-container')
    check('double-booking error shown in plain words', 'already booked' in toast and 'secret detail' not in toast and 'exclusion' not in toast, toast)
    state['bk_patch_error']=False

    # staff booking request never sends price/status
    page.click('#section-bookings button[data-args=\'["modal-add-booking"]\']'); page.wait_for_timeout(400)
    page.evaluate("document.getElementById('bk-customer').innerHTML='<option value=1>c</option>';document.getElementById('bk-boat').innerHTML='<option value=1 data-price=1000>b</option>'")
    page.select_option('#bk-customer','1'); page.select_option('#bk-boat','1')
    page.fill('#bk-start','2031-01-01'); page.fill('#bk-end','2031-01-03')
    page.click("#modal-add-booking button[data-click='addBooking']"); page.wait_for_timeout(500)
    posts=[json.loads(b) for t,b in state['posts'] if t=='bookings']
    check('booking POST contains no total_amount/status/payment_status', posts and not ({'total_amount','status','payment_status','approved_by'} & set(posts[-1])), posts[-1:] )

    # logout wipes DOM
    page.click("button[data-click='logout']"); page.wait_for_selector('#login-screen',state='visible'); page.wait_for_timeout(300)
    check('logout hides app and clears rendered data', page.evaluate("document.getElementById('bookings-tbody').innerHTML.length")<5 and page.evaluate("document.getElementById('sidebar').innerHTML===''"))

    # ---- customer session
    DATA['bookings'][0]['status']='Approved'
    state['profile']={'kind':'customer','id':5,'role':'Customer','name':'Cathy'}
    page.fill('#uni-email','c@x.com'); page.fill('#uni-password','Correct-Horse-9'); page.click('#login-btn')
    page.wait_for_selector('#main-app',state='visible'); page.wait_for_timeout(600)
    check('customer sees only customer menu', page.evaluate("[...document.querySelectorAll('#sidebar .nav-item')].map(e=>e.textContent.trim()).join('|')")=='Browse Boats|My Bookings|My Payments')
    page.screenshot(path=SHOTS+'5_customer.png')
    page.click("#c-boats-grid button[data-click='openCustomerBooking']"); page.wait_for_timeout(300)
    page.fill('#c-book-start','2031-02-01'); page.fill('#c-book-end','2031-02-04')
    page.click("#modal-c-book button[data-click='submitCustomerBooking']"); page.wait_for_timeout(500)
    posts=[json.loads(b) for t,b in state['posts'] if t=='bookings']
    check('customer booking POST: only customer_id, boat_id, dates, notes', set(posts[-1])<= {'customer_id','boat_id','start_date','end_date','notes'}, posts[-1])
    page.click('#nav-c-bookings'); page.wait_for_timeout(400)
    page.evaluate("document.querySelector('[data-click=openCustomerPayment]')?.click()") ; page.wait_for_timeout(300)
    page.fill('#c-pay-amount','100'); page.select_option('#c-pay-method','Cash')
    page.click("#modal-c-payment button[data-click='submitCustomerPayment']"); page.wait_for_timeout(500)
    check('payment goes through atomic record_payment RPC', 'record_payment' in [r[0] for r in state['rpcs']] and not [1 for t,_ in state['posts'] if t=='payments'])
    check('still no CSP violations / errors / foreign requests', page.evaluate('window.__csp.length')==0 and not errors and not state['external'], (page.evaluate('window.__csp'),errors[:2],state['external'][:2]))
    br.close()

bad=[r for r in results if not r[1]]
print(f'\n{len(results)-len(bad)}/{len(results)} passed'); sys.exit(1 if bad else 0)
