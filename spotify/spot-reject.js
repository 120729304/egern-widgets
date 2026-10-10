// 通用请求拦截：广告、埋点、统计类接口直接返回空 200 打发掉
console.log('spot-reject: ' + $request.url);
$done({
  response: {
    status: 200,
    headers: {
      'content-length': '0',
      'content-type': 'text/plain'
    },
    body: ''
  }
});
