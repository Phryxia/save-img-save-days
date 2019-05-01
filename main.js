const http = require('http');
const request = require('request');
const cheerio = require('cheerio');
const PixivAppApi = require('pixiv-app-api');
const PixivImg = require('pixiv-img');
const assert = require('assert');
const fs = require('fs');

// Load pixiv api
if(!process.argv[2] || !process.argv[3]) {
	console.log('usage: node main.js {pixiv id} {pixi pw}');
	exit();
}
const pixiv = new PixivAppApi(process.argv[2], process.argv[3]);
console.log('Success to login in in pixiv');

// http.createServer(function(req, res) {
// 	/*
// 		HTTP Header 전송
// 		HTTP Status: 200: OK
// 		Content Type: text/plain
// 	*/
// 	res.writeHead(200, {'Content-Type': 'text/plain'});

// 	res.end('hello world\n');
// }).listen(4577);

let save_path = 'D:\\images\\out\\';

// Check whether there is proper save path.
// If there is no such path, create new one.
try {
	if(!fs.existsSync(save_path))
		fs.mkdirSync(save_path);
} catch(e) {
	console.log(e);
}

// define regular expression with frequently used
let REGEX_TWITTER = /twitter\.com/;
let REGEX_FILENAME = /[^/]+\.[a-z0-9]*$/i;
let REGEX_PIXIV = /pixiv\.net/;

// Open url and extract the image
//let url = 'https://twitter.com/dawn4ir/status/1123125089359155201?s=09';
let url = 'https://www.pixiv.net/member_illust.php?illust_id=73097835&mode=medium';
classify_url(url);

/*
	Check url and return the proper finder
	to extract image. If there is no matched
	finder, return null.
*/
function classify_url(url, on_finish) {
	if(REGEX_TWITTER.test(url))
		find_img_url_twitter(url);
	else if(REGEX_PIXIV.test(url))
		find_img_url_pixiv(url);
	else {
		console.log('[WARNING] Cannot classify the given url:');
		console.log(url);
	}
}

/*
	트위터는 사용자의 이미지를 https://pbs.twimg.com/media/~~
	에 저장한다. 하지만 사용자가 요청한 페이지에 이런 이미지가
	한 장이라는 보장은 없다. 계정 헤더나 프로필 사진 역시 이런
	주소가 포함돼 있다.

	트윗에 올린 이미지는 <div class='AdaptiveMedia-container'>
	의 자식 DOM에 존재한다. 업로드된 이미지의 숫자에 따라 내부
	구조가 조금씩 다르기는 하지만, 확실한 건 추출해야 할 이미지는
	반드시 이 DOM 내부에 다 들어있다는 것이다.

	2019-04-30 기준
*/
function find_img_url_twitter(url) {
	assert.ok(url);
	request(url, function(err, res, body) {
		let $ = cheerio.load(body);
		let result = $('.AdaptiveMedia-container')
			.find('img')
			.each((idx, val)=>{
				save_img($(val).attr('src'));
			});
	});
};

/*
	픽시브에서 GET으로 받아올 수 있는 페이지에는 정작
	일러스트가 포함돼 있지 않다. 브라우저에서 페이지 로드가
	완료된 이후 이미지를 동적으로 표시하기 때문이다.

	때문에 직접 페이지를 파싱하기보다는 API를 사용하는 것이
	정신건강에 이롭다.

	akameco/pixiv-app-api를 사용하여 illustDetail(id)로
	JSON을 받아온 뒤, metaPages에 들어있는 URL을 활용하여
	저장하면 된다.

	이때 pixiv 측에서 일반적인 요청은 400 에러로 블락해버리기
	때문에, akameco/pixiv-img 모듈을 써서 다운받아야 한다.

	2019-05-01 기준
*/
function find_img_url_pixiv(url) {
	assert.ok(url);

	// extract image id
	let img_id = url.match(/illust_id=[0-9]+/)[0];
	img_id = img_id.match(/[0-9]+/)[0];
	console.log('try to fetch ' + img_id);
	
	// process
	pixiv.illustDetail(img_id)
		.then(json => {
			// fetch image meta data
			json.illust.metaPages.forEach(meta_info => {
				// extract filename from url and make output path
				let img_url = meta_info.imageUrls.original;
				let fname = img_url.match(REGEX_FILENAME)[0];
				PixivImg(img_url, save_path + '/' + fname)
					.then(out => {
						console.log('Finished downloading: ' + out);
					})
					.catch(err => {
						console.log('[WARNING] find_img_url_pixiv: error has been occured while saving image');
						console.log(err.message);
					});
			});
		})
		.catch(err => {
			console.log('[WARNING] find_img_url_pixiv: error has been occured while fetching metadata');
			console.log(err.message);
		});
}

/*
	url을 요청하여 저장한다.
	
	이 함수가 만능은 아닌 것이, 이따금 파일 경로를 직접
	요청하면 블락하는 사이트도 존재한다. (ex: pixiv)
	이 경우 다른 방법을 생각해내야 한다.
*/
function save_img(url) {
	let fname = url.match(REGEX_FILENAME);
	console.log('detect ' + fname);
	let fos = fs.createWriteStream(save_path + '/' + fname[0]);
	let stream = request({
		uri: url
	}).pipe(fos).on('finish', () => {
		console.log('Finished downloading: ' + fname[0]);
		console.log('  from ' + url);
	}).on('error', (err) => {
		console.log('[WARNING] save_img: error has been occured from fs:');
		console.log(err);
	});
};